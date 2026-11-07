import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Notice } from '@/components/ui'
import { WalletAction } from '@/components/WalletAction'
import { useNow } from '@/hooks/queries'
import { useTx } from '@/hooks/useTx'
import { FACTORY_ADDRESS, MAX_TARGET_USDC, factoryAbi } from '@/lib/contracts'
import { humanizeError } from '@/lib/errors'
import { money, parseMoney } from '@/lib/format'
import { encodePitch } from '@/lib/metadata'
import { createdRound } from '@/lib/rpc'
import { parseUsdc } from '@/onchain-money'

const MIN_LEAD_SECONDS = 10 * 60
const MAX_LEAD_SECONDS = 365 * 24 * 3600

function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function NewRound() {
  const navigate = useNavigate()
  const { send, phase } = useTx()
  const [title, setTitle] = useState('')
  const [pitch, setPitch] = useState('')
  const [target, setTarget] = useState('')
  const [date, setDate] = useState('')
  const [cap, setCap] = useState('')
  const [error, setError] = useState<string | null>(null)

  const now = useNow()
  const today = localDateString(new Date(now * 1000))

  const targetRaw = parseMoney(target)
  const capRaw = parseMoney(cap)
  const deadline = date ? Math.floor(new Date(`${date}T23:59:59`).getTime() / 1000) : undefined

  const problem = useMemo(() => {
    if (!title.trim()) return 'Give your round a title.'
    if (title.length > 80) return 'Keep the title under 80 characters.'
    if (pitch.length > 140) return 'Keep the pitch to one line (140 characters).'
    if (targetRaw === undefined || targetRaw === 0n) return 'Enter how much you want to raise.'
    if (targetRaw > parseUsdc(String(MAX_TARGET_USDC))) {
      return `Rounds are for small raises. The goal can be at most $${MAX_TARGET_USDC.toLocaleString()}.`
    }
    if (!deadline) return 'Pick a deadline.'
    const nowSec = now
    if (deadline < nowSec + MIN_LEAD_SECONDS) return 'Pick a deadline that is in the future.'
    if (deadline > nowSec + MAX_LEAD_SECONDS) return 'Deadlines can be at most one year away.'
    if (capRaw === undefined || capRaw === 0n) return 'Set the most one backer can put in.'
    if (capRaw > targetRaw) return 'The per-backer limit cannot be more than the goal.'
    return null
  }, [title, pitch, targetRaw, deadline, capRaw, now])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (problem || !FACTORY_ADDRESS || targetRaw === undefined || capRaw === undefined || !deadline) return
    try {
      const hash = await send({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: 'createRound',
        args: [title.trim(), encodePitch(pitch.trim()), targetRaw, BigInt(deadline), capRaw],
      })
      const created = await createdRound(hash)
      if (created) navigate(`/round/${created}`)
      else navigate('/')
    } catch (err) {
      setError(humanizeError(err))
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-24">
      <h1 className="display mt-4 text-3xl font-bold text-balance">Start a round</h1>
      <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
        Set a goal and a deadline. You are paid only if you reach the goal. Otherwise everyone gets their money back.
      </p>

      {!FACTORY_ADDRESS && (
        <div className="mt-4">
          <Notice tone="info">Round is not connected to a registry yet, so new rounds cannot be opened.</Notice>
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="card mt-5 space-y-4 p-5">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" className="field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pre-orders for the first 50 units" />
        </div>
        <div>
          <label className="label" htmlFor="pitch">One-line pitch</label>
          <input id="pitch" className="field" maxLength={140} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="What you are building and why" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="target">Goal (USDC)</label>
            <input id="target" className="field tabular-nums" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="5000" />
          </div>
          <div>
            <label className="label" htmlFor="cap">Max per backer</label>
            <input id="cap" className="field tabular-nums" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="1000" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="deadline">Deadline</label>
          <input id="deadline" type="date" className="field" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>Backing closes at the end of this day, your local time.</p>
        </div>

        {targetRaw !== undefined && capRaw !== undefined && !problem && (
          <div className="inner px-4 py-3 text-sm" style={{ color: 'var(--ink-2)' }}>
            Raise <strong>{money(targetRaw)} USDC</strong> by {date}. Each backer can put in up to <strong>{money(capRaw)} USDC</strong>.
          </div>
        )}
        {problem && (title || target || date || cap) && <p className="text-sm" style={{ color: 'var(--muted)' }}>{problem}</p>}
        {error && <Notice tone="error">{error}</Notice>}

        <WalletAction
          label="Open round"
          phase={phase}
          submit
          disabled={!!problem || !FACTORY_ADDRESS}
        />
      </form>
    </main>
  )
}
