import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { allRounds, allowanceOf, capTable, positionOf, roundSummaries, roundSummary, usdcBalanceOf } from '@/lib/rpc'

const POLL = 8_000

export function useRounds() {
  return useQuery({ queryKey: ['rounds'], queryFn: async () => roundSummaries(await allRounds()), refetchInterval: POLL * 2 })
}

export function useRound(address: Address | undefined) {
  return useQuery({
    queryKey: ['round', address],
    queryFn: () => roundSummary(address as Address),
    enabled: !!address,
    refetchInterval: POLL,
  })
}

export function useCapTable(address: Address | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['capTable', address],
    queryFn: () => capTable(address as Address),
    enabled: !!address && enabled,
    refetchInterval: POLL * 2,
  })
}

export function useMyPosition(round: Address | undefined, account: Address | undefined) {
  return useQuery({
    queryKey: ['position', round, account],
    queryFn: () => positionOf(round as Address, account as Address),
    enabled: !!round && !!account,
    refetchInterval: POLL,
  })
}

export function useUsdcBalance(account: Address | undefined) {
  return useQuery({
    queryKey: ['usdcBalance', account],
    queryFn: () => usdcBalanceOf(account as Address),
    enabled: !!account,
    refetchInterval: POLL,
  })
}

export function useAllowance(account: Address | undefined, spender: Address | undefined) {
  return useQuery({
    queryKey: ['allowance', account, spender],
    queryFn: () => allowanceOf(account as Address, spender as Address),
    enabled: !!account && !!spender,
    refetchInterval: POLL,
  })
}

/** Current unix time in seconds, ticking once a second. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}
