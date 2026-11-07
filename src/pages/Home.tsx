import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { RoundCard } from '@/components/RoundCard'
import { Notice } from '@/components/ui'
import { useNow, useRounds } from '@/hooks/queries'
import { FACTORY_ADDRESS } from '@/lib/contracts'

export default function Home() {
  const { data, isLoading, isError, refetch } = useRounds()
  const now = useNow()

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24">
      <section className="py-8 sm:py-12">
        <h1 className="display max-w-2xl text-4xl font-bold text-balance sm:text-5xl">
          Raise a small round. Keep every dollar honest.
        </h1>
        <p className="mt-3 max-w-xl text-base text-pretty" style={{ color: 'var(--muted)' }}>
          Collect up to $10,000 from customers, angels and friends. Hit your goal and you get paid. Miss it and every
          backer gets their money back automatically. No company, no bank, no platform fee.
        </p>
        <Link to="/new" className="btn-primary mt-6">
          <Plus className="size-4" /> Start a round
        </Link>
      </section>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
        All rounds
      </h2>

      {!FACTORY_ADDRESS && (
        <Notice tone="info">Round is not connected to a registry yet. Set the registry address in the app settings to see rounds.</Notice>
      )}
      {FACTORY_ADDRESS && isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card h-44 animate-pulse" />
          ))}
        </div>
      )}
      {isError && (
        <Notice tone="error">
          We could not load rounds right now.{' '}
          <button className="underline" onClick={() => void refetch()}>
            Try again
          </button>
        </Notice>
      )}
      {data && data.length === 0 && (
        <div className="card p-8 text-center">
          <p className="display text-xl font-bold">No rounds yet</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Be the first to open one.
          </p>
          <Link to="/new" className="btn-primary mt-4">
            Start a round
          </Link>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((r) => (
            <RoundCard key={r.address} round={r} now={now} />
          ))}
        </div>
      )}
    </main>
  )
}
