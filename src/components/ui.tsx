import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { timeLeft, type RoundStatus } from '@/lib/format'

const PILL: Record<RoundStatus, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: '#1061a6', bg: 'rgba(16,97,166,0.10)' },
  funded: { label: 'Funded', color: '#1a8047', bg: 'rgba(26,128,71,0.12)' },
  settled: { label: 'Settled', color: '#1a8047', bg: 'rgba(26,128,71,0.12)' },
  refunded: { label: 'Refunded', color: '#ba2b4c', bg: 'rgba(186,43,76,0.10)' },
  finalize_pending: { label: 'Goal met · finalize pending', color: '#9a6200', bg: 'rgba(154,98,0,0.12)' },
  ended: { label: 'Goal missed · finalize pending', color: '#9a6200', bg: 'rgba(154,98,0,0.12)' },
}

export function StatusPill({ status }: { status: RoundStatus }) {
  const p = PILL[status]
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold"
      style={{ color: p.color, background: p.bg }}
    >
      {p.label}
    </span>
  )
}

export function ProgressBar({ value, done }: { value: number; done?: boolean }) {
  const width = Math.min(100, Math.max(0, value))
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'rgba(18,45,69,0.08)' }}
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full origin-left rounded-full"
        style={{ background: done ? 'var(--success)' : 'var(--accent)', width: '100%' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: width / 100 }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
      />
    </div>
  )
}

export function ProgressRing({
  value,
  done,
  children,
}: {
  value: number
  done?: boolean
  children: ReactNode
}) {
  const size = 220
  const stroke = 14
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(18,45,69,0.08)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? 'var(--success)' : 'var(--accent)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped / 100) }}
          transition={{ type: 'spring', stiffness: 80, damping: 22 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

export function Countdown({ deadline, now }: { deadline: number; now: number }) {
  const t = timeLeft(deadline, now)
  if (t.over) {
    return <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Deadline reached</span>
  }
  const cells: [number, string][] = [
    [t.days, 'days'],
    [t.hours, 'hrs'],
    [t.minutes, 'min'],
    [t.seconds, 'sec'],
  ]
  return (
    <div className="flex items-center justify-center gap-2" aria-label="Time left">
      {cells.map(([n, label]) => (
        <div key={label} className="inner min-w-[58px] px-2 py-2 text-center">
          <div className="display text-xl font-bold tabular-nums">{String(n).padStart(2, '0')}</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <Loader2 className="size-4 animate-spin" /> {label}
    </span>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'info' | 'success'; children: ReactNode }) {
  const color = tone === 'error' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--ink-2)'
  const bg = tone === 'error' ? 'rgba(186,43,76,0.08)' : tone === 'success' ? 'rgba(26,128,71,0.09)' : 'var(--surface-muted)'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-sm font-medium text-pretty" style={{ color, background: bg }}>
      {children}
    </div>
  )
}
