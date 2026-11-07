import { formatUnitsFixed, parseUnitsExact } from '@/onchain-money'
import { USDC_DECIMALS } from './contracts'
import type { RoundData } from './rpc'

/** Format a raw USDC amount as "1,250" or "1,250.50". Decimals come from the facts module. */
export function money(raw: bigint): string {
  const fixed = formatUnitsFixed(raw, USDC_DECIMALS, 2)
  const [whole, frac = '00'] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === '00' ? grouped : `${grouped}.${frac}`
}

/** Parse user input into raw USDC units; undefined when empty or invalid. */
export function parseMoney(input: string): bigint | undefined {
  const value = input.trim()
  if (!value || !/^\d*\.?\d*$/.test(value) || value === '.') return undefined
  try {
    return parseUnitsExact(value, USDC_DECIMALS)
  } catch {
    return undefined
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function percent(raised: bigint, target: bigint): number {
  if (target === 0n) return 0
  return Number((raised * 10_000n) / target) / 100
}

export type RoundStatus = 'open' | 'funded' | 'settled' | 'refunded' | 'ended' | 'finalize_pending'

/**
 * open              collecting, goal not met yet
 * funded            goal met, still inside the window
 * finalize_pending  window over, goal met, waiting for someone to close it
 * ended             window over, goal missed, waiting for someone to close it
 */
export function statusOf(round: RoundData, nowSec: number): RoundStatus {
  if (round.state === 'settled') return 'settled'
  if (round.state === 'refunded') return 'refunded'
  const met = round.totalRaised >= round.target
  if (nowSec >= round.deadline) return met ? 'finalize_pending' : 'ended'
  return met ? 'funded' : 'open'
}

export function timeLeft(deadline: number, nowSec: number) {
  const diff = Math.max(0, deadline - nowSec)
  return {
    over: diff === 0,
    days: Math.floor(diff / 86_400),
    hours: Math.floor((diff % 86_400) / 3_600),
    minutes: Math.floor((diff % 3_600) / 60),
    seconds: diff % 60,
  }
}

export function daysLeftLabel(deadline: number, nowSec: number): string {
  const t = timeLeft(deadline, nowSec)
  if (t.over) return 'Ended'
  if (t.days >= 1) return `${t.days} day${t.days === 1 ? '' : 's'} left`
  if (t.hours >= 1) return `${t.hours}h left`
  return `${Math.max(1, t.minutes)}m left`
}
