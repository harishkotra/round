import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react'
import { BackPanel } from '@/components/BackPanel'
import { CapTable } from '@/components/CapTable'
import { RoundActions } from '@/components/RoundActions'
import { Countdown, Notice, ProgressRing, StatusPill } from '@/components/ui'
import { useMyPosition, useNow, useRound } from '@/hooks/queries'
import { CHAIN_ID } from '@/lib/contracts'
import { money, percent, shortAddress, statusOf } from '@/lib/format'
import { buildShareLink } from '@/lib/share'
import { buildAddressExplorerUrl } from '@/onchain-facts'

function YourBacking({ round }: { round: NonNullable<ReturnType<typeof useRound>['data']> }) {
  const { address, isConnected } = useAccount()
  const { data } = useMyPosition(round.address, address)
  const mine = data?.amount ?? 0n
  const isCreator = !!address && address.toLowerCase() === round.creator.toLowerCase()

  return (
    <section className="card p-5" style={{ borderColor: mine > 0n ? 'var(--border-strong)' : undefined }}>
      <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>Your backing</div>
      {!isConnected ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to see how much you have put into this round.</p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="display text-4xl font-bold tabular-nums">{money(mine)}</span>
            <span className="text-lg" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {data === undefined
              ? 'Checking…'
              : mine > 0n
                ? round.state === 'refunded'
                  ? 'Waiting for you to take this back.'
                  : 'Held safely until this round settles.'
                : data.refunded
                  ? 'You took your money back from this round.'
                  : isCreator
                    ? 'You opened this round.'
                    : 'You have not backed this round yet.'}
          </p>
        </>
      )}
    </section>
  )
}

export default function RoundPage() {
  const { address: param } = useParams()
  const valid = !!param && isAddress(param)
  const { data: round, isLoading, isError } = useRound(valid ? param : undefined)
  const now = useNow()
  const [shareUrl, setShareUrl] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!valid) return
    let alive = true
    void buildShareLink(`/round/${param}`).then((u) => alive && setShareUrl(u))
    return () => {
      alive = false
    }
  }, [valid, param])

  async function copy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="size-4" /> All rounds
      </Link>

      {!valid && <Notice tone="error">That round link does not look right.</Notice>}
      {valid && isLoading && <div className="card h-96 animate-pulse" />}
      {valid && isError && <Notice tone="error">We could not find this round. Check the link and try again.</Notice>}

      {round && (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <section className="card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="display text-3xl font-bold text-balance">{round.title}</h1>
                  {round.pitch && <p className="mt-1 text-pretty" style={{ color: 'var(--muted)' }}>{round.pitch}</p>}
                </div>
                <StatusPill status={statusOf(round, now)} />
              </div>

              <div className="my-6">
                <ProgressRing
                  value={percent(round.totalRaised, round.target)}
                  done={round.totalRaised >= round.target}
                >
                  <span className="display text-4xl font-bold tabular-nums">{Math.floor(percent(round.totalRaised, round.target))}%</span>
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>of the goal</span>
                </ProgressRing>
              </div>

              <div className="text-center">
                <div className="display text-3xl font-bold tabular-nums">
                  {money(round.totalRaised)} <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>of {money(round.target)} USDC</span>
                </div>
                <div className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                  {round.backerCount} backer{round.backerCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="mt-5">
                <Countdown deadline={round.deadline} now={now} />
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                <a className="inline-flex items-center gap-1" href={buildAddressExplorerUrl(CHAIN_ID, round.creator)} target="_blank" rel="noreferrer">
                  Opened by <span className="mono">{shortAddress(round.creator)}</span> <ExternalLink className="size-3" />
                </a>
                <button type="button" className="btn-ghost !min-h-9 !px-3 text-xs" onClick={() => void copy()} disabled={!shareUrl}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </section>

            {round.state !== 'open' && <CapTable round={round} />}
          </div>

          <div className="space-y-4">
            <YourBacking round={round} />
            {round.state === 'open' && now < round.deadline && <BackPanel round={round} />}
            <RoundActions round={round} now={now} />
          </div>
        </div>
      )}
    </main>
  )
}
