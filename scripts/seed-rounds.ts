/**
 * Seeds two real rounds on Arc Testnet from two separate Circle wallets.
 *
 *   bun run ./scripts/seed-rounds.ts wallets   # create wallet A and B, print addresses
 *   bun run ./scripts/seed-rounds.ts run       # run the whole scenario (resumable)
 *
 * Round "goal reached":  creator A, backed by B up to the goal -> closed -> A collects.
 * Round "goal missed":   creator B, backed by A below the goal -> closed -> A refunds.
 * Progress is saved in contracts/seed-state.json (no secrets), so a rerun resumes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { createPublicClient, erc20Abi, http, parseEventLogs, type Address, type Hash } from 'viem'
import { arcTestnet } from 'viem/chains'
import { requireChain, getUsdc } from '../src/onchain-facts'
import { formatUnitsExact, parseUnitsExact, usdcDecimalsFor } from '../src/onchain-money'
import { waitForSuccessfulTransaction } from '../src/onchain-wait'
import { encodePitch } from '../src/lib/metadata'
import { factoryAbi, roundAbi } from '../src/lib/contracts'

const STATE_PATH = path.join(process.cwd(), 'contracts', 'seed-state.json')
const CHAIN_ID = arcTestnet.id
const DECIMALS = usdcDecimalsFor(CHAIN_ID)
const USDC = getUsdc(CHAIN_ID)?.address as Address
const FACTORY = process.env.VITE_ROUND_FACTORY_ADDRESS as Address
const BLOCKCHAIN = 'ARC-TESTNET' as const
const LEAD_SECONDS = 300

const apiKey = process.env.CIRCLE_API_KEY
const entitySecret = process.env.CIRCLE_ENTITY_SECRET
if (!apiKey || !entitySecret) throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set')
if (!FACTORY) throw new Error('VITE_ROUND_FACTORY_ADDRESS must be set')

const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })

// Backend RPC: sandbox proxy first, public RPC from the facts module as fallback.
const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
const rpcUrl =
  process.env.RPC_URL_Arc_Testnet ||
  (process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Testnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : requireChain(CHAIN_ID).rpcUrls[0])
const rpc = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { retryCount: 3 }) })

interface Wallet {
  id: string
  address: Address
}
interface Step {
  circleTxId: string
  txHash: Hash
}
interface State {
  walletSetId?: string
  A?: Wallet
  B?: Wallet
  deadline?: number
  roundSettle?: Address
  roundRefund?: Address
  steps: Record<string, Step>
}

const state: State = fs.existsSync(STATE_PATH)
  ? (JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as State)
  : { steps: {} }
const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const units = (whole: string) => parseUnitsExact(whole, DECIMALS)
const fmt = (raw: bigint) => formatUnitsExact(raw, DECIMALS)

async function createWallets() {
  if (state.A && state.B) return
  const set = await circle.createWalletSet({ name: 'Round seed wallets' })
  const walletSetId = set.data?.walletSet?.id
  if (!walletSetId) throw new Error('Wallet set was not created')
  const res = await circle.createWallets({
    accountType: 'EOA',
    blockchains: [BLOCKCHAIN],
    count: 2,
    walletSetId,
  })
  const [a, b] = res.data?.wallets ?? []
  if (!a?.address || !b?.address) throw new Error('Wallets were not created')
  state.walletSetId = walletSetId
  state.A = { id: a.id, address: a.address as Address }
  state.B = { id: b.id, address: b.address as Address }
  save()
}

async function balanceOf(who: Address): Promise<bigint> {
  return rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [who] })
}

/** Execute one contract call from a wallet, wait until COMPLETE, record the tx hash. */
async function exec(
  name: string,
  wallet: Wallet,
  contractAddress: Address,
  abiFunctionSignature: string,
  abiParameters: string[],
): Promise<Hash> {
  const done = state.steps[name]
  if (done) return done.txHash
  const created = await circle.createContractExecutionTransaction({
    walletId: wallet.id,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  })
  const id = created.data?.id
  if (!id) throw new Error(`${name}: Circle did not return a transaction id`)
  const finished = await waitForSuccessfulTransaction(
    () => circle.getTransaction({ id }),
    (r) => r.data?.transaction?.state,
    { label: name, intervalMs: 2000, timeoutMs: 240_000 },
  )
  const txHash = finished.data?.transaction?.txHash as Hash | undefined
  if (!txHash) throw new Error(`${name}: no transaction hash returned`)
  const receipt = await rpc.getTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') throw new Error(`${name}: reverted onchain (${txHash})`)
  state.steps[name] = { circleTxId: id, txHash }
  save()
  console.log(`  ok  ${name.padEnd(26)} ${txHash}`)
  return txHash
}

async function createRound(
  name: string,
  creator: Wallet,
  title: string,
  pitch: string,
  target: string,
  cap: string,
  deadline: number,
): Promise<Address> {
  const hash = await exec(name, creator, FACTORY, 'createRound(string,string,uint256,uint64,uint256)', [
    title,
    encodePitch(pitch),
    units(target).toString(),
    String(deadline),
    units(cap).toString(),
  ])
  const receipt = await rpc.getTransactionReceipt({ hash })
  const logs = parseEventLogs({ abi: factoryAbi, eventName: 'RoundCreated', logs: receipt.logs })
  const round = logs[0]?.args.round
  if (!round) throw new Error(`${name}: RoundCreated event not found`)
  return round
}

async function back(prefix: string, backer: Wallet, round: Address, amount: string) {
  await exec(`${prefix}.approve`, backer, USDC, 'approve(address,uint256)', [round, units(amount).toString()])
  await exec(`${prefix}.commit`, backer, round, 'commit(uint256)', [units(amount).toString()])
}

async function waitUntilCloseable(round: Address) {
  for (let i = 0; i < 120; i++) {
    try {
      await rpc.simulateContract({ address: round, abi: roundAbi, functionName: 'close', account: state.A!.address })
      return
    } catch {
      await sleep(5000)
    }
  }
  throw new Error('Deadline did not pass in time')
}

async function run() {
  await createWallets()
  const A = state.A!
  const B = state.B!
  console.log(`Wallet A ${A.address}\nWallet B ${B.address}`)

  const [balA, balB] = await Promise.all([balanceOf(A.address), balanceOf(B.address)])
  console.log(`USDC balances: A ${fmt(balA)}  B ${fmt(balB)}`)
  if (balA < units('2') || balB < units('4')) {
    throw new Error('Wallets need test USDC first (A >= 2, B >= 4). Fund them, then rerun.')
  }

  if (!state.deadline) {
    const head = await rpc.getBlock()
    state.deadline = Number(head.timestamp) + LEAD_SECONDS
    save()
  }
  const deadline = state.deadline

  console.log('\n1. Open both rounds (separate creators)')
  state.roundSettle ??= await createRound(
    'settle.createRound', A, 'Seed: goal reached',
    'Created by wallet A and fully backed by wallet B.', '2', '2', deadline,
  )
  state.roundRefund ??= await createRound(
    'refund.createRound', B, 'Seed: goal missed',
    'Created by wallet B and only partly backed by wallet A.', '5', '5', deadline,
  )
  save()
  const settle = state.roundSettle
  const refund = state.roundRefund

  console.log('\n2. Backers commit')
  await back('settle.backerB', B, settle, '2') // hits the 2 USDC goal
  await back('refund.backerA', A, refund, '1') // misses the 5 USDC goal

  console.log('\n3. Wait for the deadline, then close both')
  await waitUntilCloseable(settle)
  await waitUntilCloseable(refund)
  await exec('settle.close', B, settle, 'close()', [])
  await exec('refund.close', A, refund, 'close()', [])

  console.log('\n4. Founder collects, backer refunds')
  const aBefore = await balanceOf(A.address)
  await exec('settle.withdraw', A, settle, 'withdraw()', [])
  await exec('refund.refund', A, refund, 'refund()', [])

  const [s, r, aAfter] = await Promise.all([
    rpc.readContract({ address: settle, abi: roundAbi, functionName: 'summary' }),
    rpc.readContract({ address: refund, abi: roundAbi, functionName: 'summary' }),
    balanceOf(A.address),
  ])
  const names = ['Open', 'Settled', 'Refunded']
  console.log('\nFinal state')
  console.log(`  ${settle}  state=${names[s[6]]}  raised=${fmt(s[7])}  withdrawn=${s[9]}`)
  console.log(`  ${refund}  state=${names[r[6]]}  raised=${fmt(r[7])}`)
  console.log(`  wallet A USDC (before collect+refund -> after): ${fmt(aBefore)} -> ${fmt(aAfter)} (net of gas)`)
  console.log('\nTRANSACTIONS')
  for (const [k, v] of Object.entries(state.steps)) console.log(`${k.padEnd(26)} ${v.txHash}`)
}

if (process.argv[2] === 'wallets') {
  await createWallets()
  console.log(`A ${state.A!.address}\nB ${state.B!.address}`)
} else if (process.argv[2] === 'run') {
  await run()
} else {
  throw new Error('Usage: seed-rounds.ts wallets|run')
}
