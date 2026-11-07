import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { useAllowance, useMyPosition, useUsdcBalance } from '@/hooks/queries'
import { useTx } from '@/hooks/useTx'
import { CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS, erc20, roundAbi } from '@/lib/contracts'
import { humanizeError } from '@/lib/errors'
import { money, parseMoney } from '@/lib/format'
import type { RoundData } from '@/lib/rpc'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUnitsExact } from '@/onchain-money'
import { Notice } from './ui'
import { WalletAction } from './WalletAction'

export function BackPanel({ round }: { round: RoundData }) {
  const { address } = useAccount()
  const { data: position } = useMyPosition(round.address, address)
  const { data: balance } = useUsdcBalance(address)
  const { data: allowance } = useAllowance(address, round.address)
  const { send, phase, lastHash } = useTx()
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'approve' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<bigint | null>(null)

  const mine = position?.amount ?? 0n
  const remaining = round.perBackerCap > mine ? round.perBackerCap - mine : 0n
  const raw = parseMoney(amount)

  let problem: string | null = null
  if (raw !== undefined) {
    if (raw === 0n) problem = 'Enter an amount greater than zero.'
    else if (raw > remaining) problem = `You can put in at most ${money(remaining)} USDC more.`
    else if (balance !== undefined && raw > balance) problem = 'You do not have enough USDC for that.'
  }

  const maxable = balance !== undefined && remaining < balance ? remaining : balance
  const busyLabel =
    step === 'approve'
      ? phase === 'signing'
        ? 'Step 1 of 2: allow USDC in your wallet…'
        : 'Step 1 of 2: confirming…'
      : step === 'commit' && allowanceNeeded()
        ? phase === 'signing'
          ? 'Step 2 of 2: confirm in your wallet…'
          : 'Step 2 of 2: confirming…'
        : undefined

  function allowanceNeeded() {
    return raw !== undefined && (allowance ?? 0n) < raw
  }

  async function back() {
    if (raw === undefined || raw === 0n || problem) return
    setError(null)
    setDone(null)
    try {
      if ((allowance ?? 0n) < raw) {
        setStep('approve')
        await send({ address: USDC_ADDRESS, abi: erc20, functionName: 'approve', args: [round.address, raw] })
      }
      setStep('commit')
      await send({ address: round.address, abi: roundAbi, functionName: 'commit', args: [raw] })
      setDone(raw)
      setAmount('')
      toast.success(`You backed this round with ${money(raw)} USDC`)
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setStep(null)
    }
  }

  const full = remaining === 0n && address !== undefined

  return (
    <section className="card p-5">
      <h2 className="display text-xl font-bold">Back this round</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        Up to {money(round.perBackerCap)} USDC each. If the goal is missed, you get all of it back.
      </p>

      <div className="inner mt-4 p-4">
        <input
          inputMode="decimal"
          aria-label="Amount in USDC"
          value={amount}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            if (/^\d*\.?\d*$/.test(v)) setAmount(v)
          }}
          placeholder="0.00"
          disabled={full}
          className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
        />
        <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
          <span>USDC · limit left {money(remaining)}</span>
          <button
            type="button"
            disabled={maxable === undefined || maxable === 0n}
            onClick={() => maxable !== undefined && setAmount(formatUnitsExact(maxable, USDC_DECIMALS))}
            className="font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent-hover)' }}
          >
            {balance !== undefined ? `Balance ${money(balance)} · Max` : 'Max'}
          </button>
        </div>
      </div>

      {problem && <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>{problem}</p>}
      {full && <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>You have reached the limit for this round.</p>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      {done !== null && lastHash && (
        <div className="mt-3">
          <Notice tone="success">
            Done. You backed this round with {money(done)} USDC.{' '}
            <a className="inline-flex items-center gap-1 underline" href={buildTxExplorerUrl(CHAIN_ID, lastHash)} target="_blank" rel="noreferrer">
              Receipt <ExternalLink className="size-3" />
            </a>
          </Notice>
        </div>
      )}

      <div className="mt-4">
        <WalletAction
          label="Back this round"
          phase={phase}
          extraBusyLabel={busyLabel}
          onClick={() => void back()}
          disabled={raw === undefined || raw === 0n || !!problem || full}
        />
      </div>
    </section>
  )
}
