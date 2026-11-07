/**
 * THE ONLY TRANSPORT. Every chain request in the app is sent from this file.
 *
 * Reads travel through an Anon-RPC worker (hash-pinned anon-client in a
 * null-origin sandboxed iframe, WebRTC transport) so the RPC provider cannot
 * link them to the user's IP address. Browser-only: nothing here may run on a
 * server, so call it from client code after mount.
 *
 * Three ways a request can leave the browser, each counted in rpcStats:
 *   anon         through the worker (retried up to 3 times, 20s each)
 *   direct       a plain fetch, with a reason that the UI shows
 *   anon_failed  a worker attempt that failed
 *
 * To point at a different RPC endpoint, edit RPC_URL (or set VITE_RPC_URL).
 * Gateways come from VITE_ANON_GATEWAYS (comma-separated host:port:certHash, in
 * priority order). Each gets an equal slice of the 20s readiness window.
 */
import { AnonRpcWorker } from '@anon-rpc/browser-harness'
import { requireChain } from '@/onchain-facts'
import { recordRpc, setChannel, type DirectReason } from './rpcStats'

const ARC_TESTNET_CHAIN_ID = 5042002

export const RPC_URL: string =
  (import.meta.env.VITE_RPC_URL as string | undefined) || requireChain(ARC_TESTNET_CHAIN_ID).rpcUrls[0]

/** Mainnet endpoint used ONLY by the harness to read the specifier contract. */
const SPECIFIER_RPC_URL = 'https://ethereum-rpc.publicnode.com'
const SPECIFIER_ADDRESS = '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e' // tor-js anonymizing network
const DEFAULT_GATEWAY = '152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'
const GATEWAY_ENTRY = /^[A-Za-z0-9.-]+:\d{1,5}:[A-Za-z0-9_=-]+$/

/** Parse a comma-separated host:port:certHash list. Invalid entries are dropped; if none remain, use the default. */
export function parseGateways(raw: string | undefined): string[] {
  const valid = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => GATEWAY_ENTRY.test(entry))
  return valid.length > 0 ? valid : [DEFAULT_GATEWAY]
}

/** host:port only. The cert hash is never shown or logged. */
export const gatewayLabel = (entry: string): string => entry.split(':').slice(0, 2).join(':')

const GATEWAYS = parseGateways(import.meta.env.VITE_ANON_GATEWAYS as string | undefined)

const TIMEOUT_MS = 20_000
const READY_WINDOW_MS = 20_000
const MAX_ATTEMPTS = 3

/** ?direct=1 sends every read with a plain fetch and labels it direct. The query parameter alone decides, in any build. */
export const DIRECT_MODE: boolean =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('direct') === '1'

export class JsonRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(error: { code?: number; message?: string; data?: unknown }) {
    super(error.message ?? 'RPC error')
    this.name = 'JsonRpcError'
    this.code = error.code ?? -32000
    this.data = error.data
  }
}

interface JsonRpcResponse {
  id?: number
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/**
 * Bootstrap provider for the harness: it reads the specifier contract on Ethereum
 * mainnet to find and hash-verify the anon-client. This is the one read that cannot
 * be anonymized by the thing it is bootstrapping, so it is counted as direct.
 */
const specifierProvider = {
  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    recordRpc('direct', 'specifier')
    const res = await fetch(SPECIFIER_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json = (await res.json()) as JsonRpcResponse
    if (json.error) throw new JsonRpcError(json.error)
    return json.result
  },
}

// ---- Module-scope singleton: created at import time so reads queue while it boots ----
let worker: AnonRpcWorker | null = null
let workerReady = false
let workerCreated = false

/** Remove gateway cert hashes from any text before it is logged or shown. */
function redact(text: string): string {
  let out = text
  for (const entry of GATEWAYS) {
    const hash = entry.split(':')[2]
    if (hash) out = out.split(entry).join(gatewayLabel(entry)).split(hash).join('[redacted]')
  }
  return out.replace(/(\b[A-Za-z0-9.-]+:\d{1,5}):[A-Za-z0-9_=-]{20,}/g, '$1')
}

/** Claim the worker's logs and re-log them with cert hashes removed. */
async function relayLogs(w: AnonRpcWorker): Promise<void> {
  try {
    for (;;) {
      const { level, args } = await w.acceptLog()
      const safe = args.map((a) => (typeof a === 'string' ? redact(a) : a))
      console[level]('[worker]', ...safe)
    }
  } catch {
    // The worker failed or was closed and its retained log lines are drained.
  }
}

type Outcome = { ready: true } | { ready: false; reason: string }

/** Try each gateway in order, giving each an equal slice of the readiness window. */
async function establish(): Promise<boolean> {
  const slice = Math.floor(READY_WINDOW_MS / GATEWAYS.length)
  for (const [i, entry] of GATEWAYS.entries()) {
    const label = gatewayLabel(entry)
    const isLast = i === GATEWAYS.length - 1
    let candidate: AnonRpcWorker
    try {
      candidate = new AnonRpcWorker({
        address: SPECIFIER_ADDRESS,
        config: { gateways: [entry] },
        preExisting: { rpcProvider: specifierProvider },
      })
    } catch (e) {
      console.warn(`[anon-rpc] gateway ${label} (${i + 1}/${GATEWAYS.length}) could not be started: ${redact(e instanceof Error ? e.message : 'unknown error')}`)
      continue
    }
    workerCreated = true
    void relayLogs(candidate)

    const outcome = await Promise.race<Outcome>([
      candidate.ready.then(
        (): Outcome => ({ ready: true }),
        (e: unknown): Outcome => ({ ready: false, reason: redact(e instanceof Error ? e.message : 'failed to start') }),
      ),
      sleep(slice).then((): Outcome => ({ ready: false, reason: `not ready within ${Math.round(slice / 1000)}s` })),
    ])

    if (outcome.ready) {
      worker = candidate
      workerReady = true
      setChannel('ready', undefined, label)
      return true
    }
    console.warn(`[anon-rpc] gateway ${label} (${i + 1}/${GATEWAYS.length}) abandoned: ${outcome.reason}`)
    if (isLast) {
      // Keep the last one alive: if it comes up after the window, the channel recovers.
      candidate.ready.then(
        () => {
          worker = candidate
          workerReady = true
          setChannel('ready', undefined, label)
        },
        () => undefined,
      )
    } else {
      candidate.close()
    }
  }
  return false
}

/** Resolves true once a worker is ready, false if none is ready inside the 20s window. */
const readiness: Promise<boolean> = DIRECT_MODE ? Promise.resolve(false) : establish()

if (DIRECT_MODE) {
  setChannel('bypassed', 'The ?direct=1 flag is on')
} else {
  setChannel('connecting')
  void readiness.then((ok) => {
    if (!ok && !workerReady) {
      setChannel(
        'unavailable',
        workerCreated ? 'No gateway came up within 20 seconds' : 'The private channel could not be created',
      )
    }
  })
}

/** Observer for how one call travelled. It only reports; it changes nothing about routing. */
export type RouteObserver = (route: 'anon' | DirectReason) => void

async function sendDirect(
  body: unknown,
  reason: DirectReason,
  onRoute?: RouteObserver,
): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  recordRpc('direct', reason)
  onRoute?.(reason)
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as JsonRpcResponse | JsonRpcResponse[]
}

/** One HTTP exchange with the RPC (a single call or a JSON-RPC batch). */
async function send(body: unknown, onRoute?: RouteObserver): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  if (DIRECT_MODE) return sendDirect(body, 'dev-flag', onRoute)

  // Calls made while the worker boots wait here.
  if (!workerReady) await readiness
  const active = workerReady ? worker : null
  if (!active) return sendDirect(body, workerCreated ? 'not-ready' : 'worker-unavailable', onRoute)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(
        active.fetch(RPC_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        TIMEOUT_MS,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as JsonRpcResponse | JsonRpcResponse[]
      recordRpc('anon')
      onRoute?.('anon')
      return json
    } catch {
      recordRpc('anon_failed')
      if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt)
    }
  }
  // Never silent: this is counted as direct with its reason and shown in the Privacy panel.
  return sendDirect(body, 'retries-failed', onRoute)
}

let nextId = 1

/** Send one JSON-RPC call to the Arc Testnet RPC. Throws JsonRpcError for RPC-level errors. */
export async function anonRpc(method: string, params: unknown[], onRoute?: RouteObserver): Promise<unknown> {
  const json = await send({ jsonrpc: '2.0', id: nextId++, method, params }, onRoute)
  const single = Array.isArray(json) ? json[0] : json
  if (!single) throw new Error('Empty RPC response')
  if (single.error) throw new JsonRpcError(single.error)
  return single.result
}

/** Send several calls as ONE request (one round trip through the private channel). */
export async function anonRpcBatch(calls: { method: string; params: unknown[] }[]): Promise<unknown[]> {
  if (calls.length === 0) return []
  const base = nextId
  nextId += calls.length
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: base + i, method: c.method, params: c.params }))
  const json = await send(body)
  const list = Array.isArray(json) ? json : [json]
  return body.map((req) => {
    const item = list.find((r) => r.id === req.id)
    if (!item) throw new Error('Missing batch response')
    if (item.error) throw new JsonRpcError(item.error)
    return item.result
  })
}
