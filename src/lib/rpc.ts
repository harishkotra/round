/**
 * THE RPC ADAPTER. Every chain read in the app goes through this file, and this
 * file's only transport is anonRpc() (see ./anonRpc.ts). viem is used here only
 * to encode calls and decode results, never to send them.
 *
 * Rule for this module: every exported function makes exactly ONE request
 * (a JSON-RPC batch counts as one). Anything that needs several requests, such
 * as polling for a receipt, is composed from these in a hook.
 *
 * Call these from client code after mount. The harness is browser-only.
 */
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  toHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { anonRpc, anonRpcBatch, JsonRpcError } from './anonRpc'
import { FACTORY_ADDRESS, USDC_ADDRESS, erc20, factoryAbi, roundAbi } from './contracts'
import { decodePitch } from './metadata'

export type RoundState = 'open' | 'settled' | 'refunded'

export interface RoundData {
  address: Address
  creator: Address
  title: string
  pitch: string
  metadataURI: string
  target: bigint
  deadline: number
  perBackerCap: bigint
  state: RoundState
  totalRaised: bigint
  backerCount: number
  withdrawn: boolean
}

export interface CapRow {
  backer: Address
  amount: bigint
}

export interface TxReceipt {
  status: 'success' | 'reverted'
  blockNumber: bigint
  logs: { address: Address; topics: Hex[]; data: Hex }[]
}

export interface RoundCreatedEvent {
  round: Address
  creator: Address
  title: string
  target: bigint
  deadline: bigint
  blockNumber: bigint
  txHash: Hash
}

/** A dry run of a write reverted. `errorName` is the contract's custom error when known. */
export class RpcRevertError extends Error {
  readonly errorName?: string
  constructor(errorName?: string, reason?: string) {
    super(reason ?? errorName ?? 'execution reverted')
    this.name = 'RpcRevertError'
    this.errorName = errorName
  }
}

const STATES: RoundState[] = ['open', 'settled', 'refunded']

function requireFactory(): Address {
  if (!FACTORY_ADDRESS) throw new Error('Round registry address is not configured')
  return FACTORY_ADDRESS
}

async function ethCall(to: Address, data: Hex): Promise<Hex> {
  return (await anonRpc('eth_call', [{ to, data }, 'latest'])) as Hex
}

async function ethCallBatch(calls: { to: Address; data: Hex }[]): Promise<Hex[]> {
  const results = await anonRpcBatch(calls.map((c) => ({ method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] })))
  return results as Hex[]
}

const summaryData = encodeFunctionData({ abi: roundAbi, functionName: 'summary' })

function toRoundData(address: Address, raw: Hex): RoundData {
  const [creator, title, metadataURI, target, deadline, perBackerCap, state, totalRaised, backerCount, withdrawn] =
    decodeFunctionResult({ abi: roundAbi, functionName: 'summary', data: raw })
  return {
    address,
    creator,
    title,
    metadataURI,
    pitch: decodePitch(metadataURI),
    target,
    deadline: Number(deadline),
    perBackerCap,
    state: STATES[state] ?? 'open',
    totalRaised,
    backerCount: Number(backerCount),
    withdrawn,
  }
}

// ---- Registry reads ------------------------------------------------------------

export async function allRounds(): Promise<Address[]> {
  const raw = await ethCall(requireFactory(), encodeFunctionData({ abi: factoryAbi, functionName: 'allRounds' }))
  return [...decodeFunctionResult({ abi: factoryAbi, functionName: 'allRounds', data: raw })].reverse() // newest first
}

export async function roundCount(): Promise<bigint> {
  const raw = await ethCall(requireFactory(), encodeFunctionData({ abi: factoryAbi, functionName: 'roundCount' }))
  return decodeFunctionResult({ abi: factoryAbi, functionName: 'roundCount', data: raw })
}

export async function roundAt(index: bigint): Promise<Address> {
  const raw = await ethCall(requireFactory(), encodeFunctionData({ abi: factoryAbi, functionName: 'roundAt', args: [index] }))
  return decodeFunctionResult({ abi: factoryAbi, functionName: 'roundAt', data: raw })
}

// ---- Single-field round reads --------------------------------------------------

export async function roundState(round: Address): Promise<RoundState> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'state' }))
  return STATES[decodeFunctionResult({ abi: roundAbi, functionName: 'state', data: raw })] ?? 'open'
}

export async function target(round: Address): Promise<bigint> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'target' }))
  return decodeFunctionResult({ abi: roundAbi, functionName: 'target', data: raw })
}

export async function deadline(round: Address): Promise<bigint> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'deadline' }))
  return decodeFunctionResult({ abi: roundAbi, functionName: 'deadline', data: raw })
}

export async function totalRaised(round: Address): Promise<bigint> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'totalRaised' }))
  return decodeFunctionResult({ abi: roundAbi, functionName: 'totalRaised', data: raw })
}

export async function commitmentOf(round: Address, backer: Address): Promise<bigint> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'commitmentOf', args: [backer] }))
  return decodeFunctionResult({ abi: roundAbi, functionName: 'commitmentOf', data: raw })
}

// ---- Full-page reads (one request each) ----------------------------------------

export async function roundSummary(round: Address): Promise<RoundData> {
  return toRoundData(round, await ethCall(round, summaryData))
}

/** Many rounds in ONE request (a JSON-RPC batch), so the home list costs one private round trip. */
export async function roundSummaries(rounds: Address[]): Promise<RoundData[]> {
  if (rounds.length === 0) return []
  const raws = await ethCallBatch(rounds.map((to) => ({ to, data: summaryData })))
  return rounds.map((address, i) => toRoundData(address, raws[i]))
}

export async function capTable(round: Address): Promise<CapRow[]> {
  const raw = await ethCall(round, encodeFunctionData({ abi: roundAbi, functionName: 'capTable' }))
  const [backers, amounts] = decodeFunctionResult({ abi: roundAbi, functionName: 'capTable', data: raw })
  return backers.map((backer, i) => ({ backer, amount: amounts[i] ?? 0n }))
}

/** A backer's commitment and refunded flag, in ONE request. */
export async function positionOf(round: Address, backer: Address): Promise<{ amount: bigint; refunded: boolean }> {
  const [amountRaw, refundedRaw] = await ethCallBatch([
    { to: round, data: encodeFunctionData({ abi: roundAbi, functionName: 'commitmentOf', args: [backer] }) },
    { to: round, data: encodeFunctionData({ abi: roundAbi, functionName: 'refunded', args: [backer] }) },
  ])
  return {
    amount: decodeFunctionResult({ abi: roundAbi, functionName: 'commitmentOf', data: amountRaw }),
    refunded: decodeFunctionResult({ abi: roundAbi, functionName: 'refunded', data: refundedRaw }),
  }
}

// ---- USDC ----------------------------------------------------------------------

export async function usdcBalanceOf(account: Address): Promise<bigint> {
  const raw = await ethCall(USDC_ADDRESS, encodeFunctionData({ abi: erc20, functionName: 'balanceOf', args: [account] }))
  return decodeFunctionResult({ abi: erc20, functionName: 'balanceOf', data: raw })
}

export async function allowanceOf(owner: Address, spender: Address): Promise<bigint> {
  const raw = await ethCall(USDC_ADDRESS, encodeFunctionData({ abi: erc20, functionName: 'allowance', args: [owner, spender] }))
  return decodeFunctionResult({ abi: erc20, functionName: 'allowance', data: raw })
}

// ---- Chain data ----------------------------------------------------------------

export async function latestBlock(): Promise<bigint> {
  return BigInt((await anonRpc('eth_blockNumber', [])) as Hex)
}

/**
 * RoundCreated events from `fromBlock` onward. Pass a bounded start (for example
 * latestBlock() minus a few thousand), never 0, so a scan stays small.
 */
export async function pastEvents(fromBlock: bigint, toBlock: bigint | 'latest' = 'latest'): Promise<RoundCreatedEvent[]> {
  const topics = encodeEventTopics({ abi: factoryAbi, eventName: 'RoundCreated' })
  const logs = (await anonRpc('eth_getLogs', [
    {
      address: requireFactory(),
      fromBlock: toHex(fromBlock),
      toBlock: toBlock === 'latest' ? 'latest' : toHex(toBlock),
      topics,
    },
  ])) as { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hash }[]
  return logs.map((log) => {
    const event = decodeEventLog({ abi: factoryAbi, eventName: 'RoundCreated', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
    return {
      round: event.args.round,
      creator: event.args.creator,
      title: event.args.title,
      target: event.args.target,
      deadline: BigInt(event.args.deadline),
      blockNumber: BigInt(log.blockNumber),
      txHash: log.transactionHash,
    }
  })
}

// ---- Transactions --------------------------------------------------------------

export interface WriteRequest {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

const ERROR_ABI = [...roundAbi, ...factoryAbi, ...erc20] as Abi

/** Dry-run a write with one eth_call so a revert becomes a named error before the wallet opens. */
export async function simulateWrite(req: WriteRequest, account: Address): Promise<void> {
  const data = encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args })
  try {
    await anonRpc('eth_call', [{ from: account, to: req.address, data }, 'latest'])
  } catch (error) {
    if (error instanceof JsonRpcError && typeof error.data === 'string' && error.data.startsWith('0x') && error.data.length > 2) {
      try {
        const decoded = decodeErrorResult({ abi: ERROR_ABI, data: error.data as Hex })
        const first: unknown = decoded.args?.[0]
        const reason = decoded.errorName === 'Error' && typeof first === 'string' ? first : undefined
        throw new RpcRevertError(decoded.errorName, reason)
      } catch (inner) {
        if (inner instanceof RpcRevertError) throw inner
      }
    }
    if (error instanceof JsonRpcError && error.message.toLowerCase().includes('revert')) throw new RpcRevertError()
    throw error
  }
}

/** The receipt, or null if the transaction is not mined yet. One request. */
export async function transactionReceipt(hash: Hash): Promise<TxReceipt | null> {
  const raw = (await anonRpc('eth_getTransactionReceipt', [hash])) as {
    status: Hex
    blockNumber: Hex
    logs: { address: Address; topics: Hex[]; data: Hex }[]
  } | null
  if (!raw) return null
  return {
    status: raw.status === '0x1' ? 'success' : 'reverted',
    blockNumber: BigInt(raw.blockNumber),
    logs: raw.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
  }
}

/** The round address created by a createRound transaction. One request. */
export async function createdRound(hash: Hash): Promise<Address | undefined> {
  const receipt = await transactionReceipt(hash)
  if (!receipt) return undefined
  for (const log of receipt.logs) {
    if (FACTORY_ADDRESS && log.address.toLowerCase() !== FACTORY_ADDRESS.toLowerCase()) continue
    try {
      const event = decodeEventLog({ abi: factoryAbi, eventName: 'RoundCreated', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      return event.args.round
    } catch {
      // not a RoundCreated log
    }
  }
  return undefined
}
