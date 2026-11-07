import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import type { Hash } from 'viem'
import { CHAIN_ID } from '@/lib/contracts'
import { simulateWrite, transactionReceipt, type WriteRequest } from '@/lib/rpc'

const POLL_MS = 1000
const RECEIPT_TIMEOUT_MS = 120_000

/** Poll for the receipt. Arc finalizes in under a second, so one inclusion is final. */
async function waitForReceipt(hash: Hash): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < RECEIPT_TIMEOUT_MS) {
    const receipt = await transactionReceipt(hash)
    if (receipt) {
      if (receipt.status !== 'success') throw new Error('Transaction failed onchain')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error('Timed out waiting for confirmation')
}

export type TxPhase = 'idle' | 'switching' | 'signing' | 'confirming'

/**
 * Runs one wallet transaction end to end with honest phases:
 * switch network -> dry run via the RPC adapter -> wallet prompt -> receipt.
 * Throws on failure; callers turn errors into sentences with humanizeError.
 */
export function useTx() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [lastHash, setLastHash] = useState<Hash | undefined>()

  const send = useCallback(
    async (req: WriteRequest): Promise<Hash> => {
      if (!address) throw new Error('Wallet not connected')
      try {
        if (chainId !== CHAIN_ID) {
          setPhase('switching')
          await switchChainAsync({ chainId: CHAIN_ID })
        }
        await simulateWrite(req, address)
        setPhase('signing')
        const hash = await writeContractAsync({
          ...req,
          chainId: CHAIN_ID,
        })
        setLastHash(hash)
        setPhase('confirming')
        await waitForReceipt(hash)
        await queryClient.invalidateQueries()
        return hash
      } finally {
        setPhase('idle')
      }
    },
    [address, chainId, queryClient, switchChainAsync, writeContractAsync],
  )

  return { send, phase, busy: phase !== 'idle', lastHash }
}
