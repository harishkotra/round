/**
 * Counts every network request the app makes to a chain RPC, by how it travelled.
 * One request increments exactly one bucket:
 *   anon         a request that completed through the Anon-RPC worker
 *   direct       a request sent with a plain fetch (always carries a reason)
 *   anon_failed  an attempt through the worker that errored or timed out
 * Totals persist in localStorage and are readable at window.__rpcStats.
 */
import { useSyncExternalStore } from 'react'

export type RpcKind = 'anon' | 'direct' | 'anon_failed'

/** Why a request went direct. `specifier` is the one expected exclusion. */
export type DirectReason = 'specifier' | 'dev-flag' | 'not-ready' | 'retries-failed' | 'worker-unavailable'

/** Where the private channel stands. Only `ready` may be described as anonymizing. */
export type ChannelStatus = 'connecting' | 'ready' | 'unavailable' | 'bypassed'

export interface RpcStatsSnapshot {
  anon: number
  direct: number
  anon_failed: number
  directReasons: Record<DirectReason, number>
}

export interface ChannelSnapshot {
  status: ChannelStatus
  detail?: string
  /** The gateway in use as host:port only (never the cert hash). Set only while ready. */
  gateway?: string
}

const STORAGE_KEY = 'round.rpcStats.v1'

const emptyStats = (): RpcStatsSnapshot => ({
  anon: 0,
  direct: 0,
  anon_failed: 0,
  directReasons: { specifier: 0, 'dev-flag': 0, 'not-ready': 0, 'retries-failed': 0, 'worker-unavailable': 0 },
})

function load(): RpcStatsSnapshot {
  const base = emptyStats()
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<RpcStatsSnapshot>
    return {
      anon: Number(parsed.anon) || 0,
      direct: Number(parsed.direct) || 0,
      anon_failed: Number(parsed.anon_failed) || 0,
      directReasons: { ...base.directReasons, ...(parsed.directReasons ?? {}) },
    }
  } catch {
    return base
  }
}

let stats: RpcStatsSnapshot = load()
let channel: ChannelSnapshot = { status: 'connecting' }
const listeners = new Set<() => void>()

function emit() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // Storage can be unavailable (private mode); counters still work in memory.
  }
  for (const l of listeners) l()
}

export function recordRpc(kind: 'anon' | 'anon_failed'): void
export function recordRpc(kind: 'direct', reason: DirectReason): void
export function recordRpc(kind: RpcKind, reason?: DirectReason): void {
  stats = { ...stats, directReasons: { ...stats.directReasons }, [kind]: stats[kind] + 1 }
  if (kind === 'direct' && reason) stats.directReasons[reason] += 1
  emit()
}

export function setChannel(status: ChannelStatus, detail?: string, gateway?: string): void {
  if (channel.status === status && channel.detail === detail && channel.gateway === gateway) return
  channel = { status, detail, gateway }
  for (const l of listeners) l()
}

export function resetRpcStats(): void {
  stats = emptyStats()
  emit()
}

export const getRpcStats = (): RpcStatsSnapshot => stats
export const getChannel = (): ChannelSnapshot => channel

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useRpcStats(): RpcStatsSnapshot {
  return useSyncExternalStore(subscribe, getRpcStats, getRpcStats)
}

export function useChannel(): ChannelSnapshot {
  return useSyncExternalStore(subscribe, getChannel, getChannel)
}

declare global {
  interface Window {
    __rpcStats?: {
      get: () => RpcStatsSnapshot
      channel: () => ChannelSnapshot
      reset: () => void
    }
  }
}

if (typeof window !== 'undefined') {
  window.__rpcStats = { get: getRpcStats, channel: getChannel, reset: resetRpcStats }
}
