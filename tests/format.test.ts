/**
 * Pure tests for statusOf. No DOM, no network.
 * Run: bun test tests
 */
import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { statusOf } from '../src/lib/format'
import type { RoundData } from '../src/lib/rpc'

const ADDRESS = '0x6eCcA4D9aEfB9d38249b5a216099a238E8494F0C' as Address
const DEADLINE = 1_800_000_000
const TARGET = 100n

function round(overrides: Partial<RoundData>): RoundData {
  return {
    address: ADDRESS,
    creator: ADDRESS,
    title: 'Test',
    pitch: '',
    metadataURI: '',
    target: TARGET,
    deadline: DEADLINE,
    perBackerCap: TARGET,
    state: 'open',
    totalRaised: 0n,
    backerCount: 0,
    withdrawn: false,
    ...overrides,
  }
}

const BEFORE = DEADLINE - 60
const AFTER = DEADLINE + 60

describe('statusOf', () => {
  test('open: goal not met, deadline not reached', () => {
    expect(statusOf(round({ totalRaised: 40n }), BEFORE)).toBe('open')
  })

  test('funded: goal met before the deadline', () => {
    expect(statusOf(round({ totalRaised: TARGET }), BEFORE)).toBe('funded')
  })

  test('finalize_pending: goal met, deadline passed, still open', () => {
    expect(statusOf(round({ totalRaised: TARGET }), AFTER)).toBe('finalize_pending')
    expect(statusOf(round({ totalRaised: TARGET + 5n }), DEADLINE)).toBe('finalize_pending')
  })

  test('ended: goal missed, deadline passed, still open', () => {
    expect(statusOf(round({ totalRaised: 40n }), AFTER)).toBe('ended')
  })

  test('settled: closed with the goal met, at any time', () => {
    expect(statusOf(round({ state: 'settled', totalRaised: TARGET }), BEFORE)).toBe('settled')
    expect(statusOf(round({ state: 'settled', totalRaised: TARGET, withdrawn: true }), AFTER)).toBe('settled')
  })

  test('refunded: closed with the goal missed, at any time', () => {
    expect(statusOf(round({ state: 'refunded', totalRaised: 40n }), AFTER)).toBe('refunded')
  })
})
