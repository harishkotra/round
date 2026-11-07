/**
 * Every function exported by src/lib/rpc.ts must make exactly one request, that
 * request must go through the Anon-RPC worker's fetch, and a plain fetch must
 * never be used. The harness is replaced here by a stand-in that answers JSON-RPC;
 * the app build itself never mocks it.
 *
 * Run: bun test tests
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  type Abi,
  type Address,
  type Hex,
} from 'viem'

const FACTORY = '0xd6c786d3eabddd791e9ad9554e56e808075a3a95' as Address
const ROUND_A = '0x6eCcA4D9aEfB9d38249b5a216099a238E8494F0C' as Address
const ROUND_B = '0x0fEA5EFCe0466eBe460e82D0F6863dfA1508Ac04' as Address
const WALLET = '0x25a45d0f995e11d42634466909a456222c3c0293' as Address
const TX = ('0x' + 'ab'.repeat(32)) as Hex

process.env.VITE_ROUND_FACTORY_ADDRESS = FACTORY

interface RpcReq {
  id: number
  method: string
  params: unknown[]
}

let respondOverride: ((req: RpcReq) => unknown) | null = null
async function defaultWorkerFetch(_url: string, init?: { body?: string }) {
  const body = JSON.parse(init?.body ?? '{}') as RpcReq | RpcReq[]
  const reqs = Array.isArray(body) ? body : [body]
  const out = reqs.map((r) => {
    const result = respondOverride ? respondOverride(r) : respond(r)
    if (result && typeof result === 'object' && 'error' in result) return { jsonrpc: '2.0', id: r.id, ...result }
    return { jsonrpc: '2.0', id: r.id, result }
  })
  return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { status: 200 })
}
const workerFetch = mock(defaultWorkerFetch)

function forbidPlainFetch(): never {
  throw new Error('plain fetch must not be used for chain reads')
}
const plainFetch = mock(forbidPlainFetch)

// Stand-in for the harness. Behaviour per gateway is controlled by workerBehavior.
class FakeWorker {
  ready: Promise<void>
  fetch = workerFetch
  gateway: string
  closed = false
  constructor(init: { config?: { gateways?: string[] } }) {
    this.gateway = init.config?.gateways?.[0] ?? ''
    workerInstances.push(this)
    this.ready = workerBehavior(this.gateway)
  }
  close() {
    this.closed = true
  }
}
const workerInstances: FakeWorker[] = []
let workerBehavior: (gateway: string) => Promise<void> = () => Promise.resolve()

mock.module('@anon-rpc/browser-harness', () => ({
  AnonRpcWorker: FakeWorker,
  RpcError: class extends Error {},
}))

type Mod = typeof import('../src/lib/rpc')
type Stats = typeof import('../src/lib/rpcStats')
let rpc: Mod
let stats: Stats
let ABI: Abi
let FIXTURES: Record<string, unknown>

function respond(req: RpcReq): unknown {
  switch (req.method) {
    case 'eth_call': {
      const call = req.params[0] as { data: Hex }
      const { functionName } = decodeFunctionData({ abi: ABI, data: call.data })
      return encodeFunctionResult({ abi: ABI, functionName, result: FIXTURES[functionName] } as never)
    }
    case 'eth_blockNumber':
      return '0x10'
    case 'eth_getLogs':
      return [{ ...creationLog(), blockNumber: '0x5', transactionHash: TX }]
    case 'eth_getTransactionReceipt':
      return { status: '0x1', blockNumber: '0x5', logs: [{ address: FACTORY, ...creationLog() }] }
    default:
      throw new Error(`unexpected method ${req.method}`)
  }
}

function creationLog() {
  return {
    topics: encodeEventTopics({ abi: rpc ? factoryAbi() : [], eventName: 'RoundCreated', args: { round: ROUND_A, creator: WALLET } } as never),
    data: encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }, { type: 'uint64' }], ['Test round', 5n, 99n]),
  }
}

let factoryAbiRef: Abi = []
const factoryAbi = () => factoryAbiRef

beforeAll(async () => {
  globalThis.fetch = plainFetch as unknown as typeof fetch
  const contracts = await import('../src/lib/contracts')
  factoryAbiRef = contracts.factoryAbi as unknown as Abi
  ABI = [...contracts.roundAbi, ...contracts.factoryAbi, ...erc20Abi] as unknown as Abi
  FIXTURES = {
    allRounds: [ROUND_B, ROUND_A],
    roundCount: 2n,
    roundAt: ROUND_A,
    state: 1,
    target: 2_000_000n,
    deadline: 1_900_000_000n,
    totalRaised: 2_000_000n,
    commitmentOf: 2_000_000n,
    refunded: false,
    balanceOf: 18_959_649n,
    allowance: 5n,
    capTable: [[WALLET], [2_000_000n]],
    summary: [WALLET, 'Test round', '', 2_000_000n, 1_900_000_000n, 2_000_000n, 1, 2_000_000n, 1n, true],
    commit: [],
  }
  stats = await import('../src/lib/rpcStats')
  rpc = await import('../src/lib/rpc')
})

beforeEach(() => {
  workerFetch.mockClear()
  plainFetch.mockClear()
  workerFetch.mockImplementation(defaultWorkerFetch)
  plainFetch.mockImplementation(forbidPlainFetch)
  respondOverride = null
  stats.resetRpcStats()
})

// name -> how to call it. Adding an export to rpc.ts without adding it here fails the coverage test below.
const CASES: Record<string, () => Promise<unknown>> = {
  allRounds: () => rpc.allRounds(),
  roundCount: () => rpc.roundCount(),
  roundAt: () => rpc.roundAt(0n),
  roundState: () => rpc.roundState(ROUND_A),
  target: () => rpc.target(ROUND_A),
  deadline: () => rpc.deadline(ROUND_A),
  totalRaised: () => rpc.totalRaised(ROUND_A),
  commitmentOf: () => rpc.commitmentOf(ROUND_A, WALLET),
  usdcBalanceOf: () => rpc.usdcBalanceOf(WALLET),
  pastEvents: () => rpc.pastEvents(1n),
  roundSummary: () => rpc.roundSummary(ROUND_A),
  roundSummaries: () => rpc.roundSummaries([ROUND_A, ROUND_B]),
  capTable: () => rpc.capTable(ROUND_A),
  positionOf: () => rpc.positionOf(ROUND_A, WALLET),
  allowanceOf: () => rpc.allowanceOf(WALLET, ROUND_A),
  latestBlock: () => rpc.latestBlock(),
  transactionReceipt: () => rpc.transactionReceipt(TX),
  createdRound: () => rpc.createdRound(TX),
  simulateWrite: async () => {
    const { roundAbi } = await import('../src/lib/contracts')
    return rpc.simulateWrite({ address: ROUND_A, abi: roundAbi as unknown as Abi, functionName: 'commit', args: [1n] }, WALLET)
  },
}

describe('lib/rpc.ts routes every read through the Anon-RPC worker', () => {
  for (const [name, call] of Object.entries(CASES)) {
    test(`${name}: exactly one worker.fetch, zero plain fetch, one anon count`, async () => {
      await call()
      expect(workerFetch).toHaveBeenCalledTimes(1)
      expect(plainFetch).toHaveBeenCalledTimes(0)
      const s = stats.getRpcStats()
      expect(s.anon).toBe(1)
      expect(s.direct).toBe(0)
      expect(s.anon_failed).toBe(0)
    })
  }

  test('the table covers every function exported by rpc.ts', () => {
    const isClass = (v: unknown) => typeof v === 'function' && /^class\s/.test(Function.prototype.toString.call(v))
    const exported = Object.entries(rpc)
      .filter(([, v]) => typeof v === 'function' && !isClass(v))
      .map(([k]) => k)
      .sort()
    expect(exported).toEqual(Object.keys(CASES).sort())
  })

  test('roundSummaries sends its many reads as one batched request', async () => {
    await rpc.roundSummaries([ROUND_A, ROUND_B])
    expect(workerFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((workerFetch.mock.calls[0]?.[1] as { body: string }).body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
  })

  test('a reverted dry run becomes a named error, still one anon request', async () => {
    const { roundAbi } = await import('../src/lib/contracts')
    respondOverride = () => ({ error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: roundAbi, errorName: 'DeadlinePassed' }) } })
    const err = await rpc
      .simulateWrite({ address: ROUND_A, abi: roundAbi as unknown as Abi, functionName: 'commit', args: [1n] }, WALLET)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(rpc.RpcRevertError)
    expect((err as InstanceType<typeof rpc.RpcRevertError>).errorName).toBe('DeadlinePassed')
    expect(workerFetch).toHaveBeenCalledTimes(1)
    expect(plainFetch).toHaveBeenCalledTimes(0)
    expect(stats.getRpcStats().anon).toBe(1)
  })
})

describe('fallback is counted, never silent', () => {
  test('three failed private attempts, then one direct request with its reason', async () => {
    workerFetch.mockImplementation(async () => {
      throw new Error('gateway unreachable')
    })
    plainFetch.mockImplementation((() =>
      Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' })))) as never)
    const block = await rpc.latestBlock()
    expect(block).toBe(16n)
    expect(workerFetch).toHaveBeenCalledTimes(3)
    expect(plainFetch).toHaveBeenCalledTimes(1)
    const s = stats.getRpcStats()
    expect(s.anon).toBe(0)
    expect(s.anon_failed).toBe(3)
    expect(s.direct).toBe(1)
    expect(s.directReasons['retries-failed']).toBe(1)
  })
})

describe('gateways', () => {
  test('parseGateways: unset or unparseable falls back to the default, order is kept, bad entries are dropped', async () => {
    const { parseGateways } = await import('../src/lib/anonRpc')
    const DEFAULT = '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'
    expect(parseGateways(undefined)).toEqual([DEFAULT])
    expect(parseGateways('')).toEqual([DEFAULT])
    expect(parseGateways('not-a-gateway, also:bad')).toEqual([DEFAULT])
    expect(parseGateways('a.example:1:HASHONE, b.example:2:HASHTWO')).toEqual(['a.example:1:HASHONE', 'b.example:2:HASHTWO'])
    expect(parseGateways('junk,b.example:2:HASHTWO')).toEqual(['b.example:2:HASHTWO'])
  })

  test('an unreachable gateway is abandoned, the next is used, and no cert hash is logged', async () => {
    const BAD_HASH = 'BADHASHBADHASHBADHASH1234'
    const GOOD_HASH = 'GOODHASHGOODHASHGOODHASH99'
    process.env.VITE_ANON_GATEWAYS = `bad.example:1111:${BAD_HASH},good.example:2222:${GOOD_HASH}`
    workerBehavior = (gateway) =>
      gateway.startsWith('bad.example') ? Promise.reject(new Error(`dial ${gateway}: refused`)) : Promise.resolve()
    workerInstances.length = 0

    const logged: string[] = []
    const original = { warn: console.warn, info: console.info, log: console.log, error: console.error }
    for (const level of ['warn', 'info', 'log', 'error'] as const) {
      console[level] = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      }
    }
    try {
      const fresh = await import('../src/lib/anonRpc.ts?failover')
      await fresh.anonRpc('eth_blockNumber', [])
    } finally {
      Object.assign(console, original)
    }

    expect(workerInstances.map((w) => w.gateway)).toEqual([
      `bad.example:1111:${BAD_HASH}`,
      `good.example:2222:${GOOD_HASH}`,
    ])
    expect(workerInstances[0]?.closed).toBe(true)
    expect(workerInstances[1]?.closed).toBe(false)
    expect(stats.getChannel().status).toBe('ready')
    expect(stats.getChannel().gateway).toBe('good.example:2222')
    expect(plainFetch).toHaveBeenCalledTimes(0)
    const text = logged.join('\n')
    expect(text).toContain('bad.example:1111')
    expect(text).not.toContain(BAD_HASH)
    expect(text).not.toContain(GOOD_HASH)
  })
})
