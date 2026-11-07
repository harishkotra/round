import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { useMyPosition } from '@/hooks/queries'
import { useTx } from '@/hooks/useTx'
import { roundAbi } from '@/lib/contracts'
import { humanizeError } from '@/lib/errors'
import { money } from '@/lib/format'
import type { RoundData } from '@/lib/rpc'
import { Notice } from './ui'
import { WalletAction } from './WalletAction'

/** Close / refund / collect panels. Each renders only when the contract would allow it. */
export function RoundActions({ round, now }: { round: RoundData; now: number }) {
  const { address } = useAccount()
  const { data: position } = useMyPosition(round.address, address)
  const { send, phase } = useTx()
  const [error, setError] = useState<string | null>(null)

  const ended = now >= round.deadline
  const met = round.totalRaised >= round.target
  const mine = position?.amount ?? 0n
  const isCreator = !!address && address.toLowerCase() === round.creator.toLowerCase()

  async function run(functionName: 'close' | 'refund' | 'withdraw', success: string) {
    setError(null)
    try {
      await send({ address: round.address, abi: roundAbi, functionName })
      toast.success(success)
    } catch (err) {
      setError(humanizeError(err))
    }
  }

  const panels = []

  if (round.state === 'open' && ended) {
    panels.push(
      <section key="close" className="card p-5">
        <h2 className="display text-xl font-bold">Close this round</h2>
        <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {met
            ? 'The goal was reached. Closing the round releases the money to the founder. Anyone can do this.'
            : 'The goal was not reached. Closing the round opens refunds so every backer can take their money back. Anyone can do this.'}
        </p>
        <div className="mt-4">
          <WalletAction label="Close round" phase={phase} onClick={() => void run('close', 'Round closed')} />
        </div>
      </section>,
    )
  }

  if (round.state === 'refunded') {
    panels.push(
      <section key="refund" className="card p-5">
        <h2 className="display text-xl font-bold">This round missed its goal</h2>
        <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Every backer can take their full amount back. Nobody, including the founder, can stop this.
        </p>
        {mine > 0n && (
          <div className="mt-4">
            <WalletAction label={`Refund ${money(mine)} USDC`} phase={phase} onClick={() => void run('refund', 'Your money is back in your wallet')} />
          </div>
        )}
        {mine === 0n && address && position?.refunded && (
          <div className="mt-4"><Notice tone="success">You have already taken your money back.</Notice></div>
        )}
        {mine === 0n && address && !position?.refunded && (
          <p className="mt-3 text-sm" style={{ color: 'var(--subtle)' }}>You did not back this round, so there is nothing to refund.</p>
        )}
      </section>,
    )
  }

  if (round.state === 'settled') {
    panels.push(
      <section key="settled" className="card p-5">
        <h2 className="display text-xl font-bold">Goal reached</h2>
        {round.withdrawn ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>The founder has collected the {money(round.totalRaised)} USDC raised.</p>
        ) : isCreator ? (
          <>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>You hit your goal. Collect the full amount raised.</p>
            <div className="mt-4">
              <WalletAction label={`Collect ${money(round.totalRaised)} USDC`} phase={phase} onClick={() => void run('withdraw', 'Funds collected')} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>The founder can now collect the {money(round.totalRaised)} USDC raised.</p>
        )}
      </section>,
    )
  }

  if (panels.length === 0) return null
  return (
    <div className="space-y-4">
      {panels}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
