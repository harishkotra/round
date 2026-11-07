import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { daysLeftLabel, money, percent, statusOf } from '@/lib/format'
import type { RoundData } from '@/lib/rpc'
import { ProgressBar, StatusPill } from './ui'

export function RoundCard({ round, now }: { round: RoundData; now: number }) {
  const status = statusOf(round, now)
  const pct = percent(round.totalRaised, round.target)
  return (
    <Link
      to={`/round/${round.address}`}
      className="card block p-5 transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="display text-lg font-bold text-balance">{round.title}</h3>
        <StatusPill status={status} />
      </div>
      {round.pitch && (
        <p className="mt-1 line-clamp-2 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {round.pitch}
        </p>
      )}
      <div className="mt-4 flex items-baseline justify-between">
        <div>
          <span className="display text-2xl font-bold tabular-nums">{money(round.totalRaised)}</span>
          <span className="ml-1 text-sm tabular-nums" style={{ color: 'var(--subtle)' }}>
            of {money(round.target)} USDC
          </span>
        </div>
        <span className="text-sm font-semibold tabular-nums">{Math.floor(pct)}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar value={pct} done={status === 'funded' || status === 'finalize_pending' || status === 'settled'} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" />
          {round.backerCount} backer{round.backerCount === 1 ? '' : 's'}
        </span>
        <span>{daysLeftLabel(round.deadline, now)}</span>
      </div>
    </Link>
  )
}
