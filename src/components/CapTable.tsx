import { ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useCapTable } from '@/hooks/queries'
import { CHAIN_ID } from '@/lib/contracts'
import { money, shortAddress } from '@/lib/format'
import type { RoundData } from '@/lib/rpc'
import { buildAddressExplorerUrl } from '@/onchain-facts'

export function CapTable({ round }: { round: RoundData }) {
  const { address: me } = useAccount()
  const settled = round.state === 'settled'
  const { data, isLoading } = useCapTable(round.address, round.state !== 'open')

  const rows = (data ?? []).slice().sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))

  return (
    <section className="card p-5">
      <h2 className="display text-xl font-bold">{settled ? 'Who backed this round' : 'Backers'}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        {settled
          ? 'Everyone who put money into this round and how much.'
          : 'Amounts still waiting to be returned. A backer drops to zero once they have taken their money back.'}
      </p>
      {isLoading && <div className="mt-4 h-20 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)' }} />}
      {data && (
        <div className="mt-4 overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          {rows.length === 0 && <p className="p-4 text-sm" style={{ color: 'var(--muted)' }}>Nobody backed this round.</p>}
          {rows.map((row, i) => {
            const isMe = !!me && me.toLowerCase() === row.backer.toLowerCase()
            return (
              <div
                key={row.backer}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: isMe ? 'rgba(133,177,237,0.16)' : 'transparent' }}
              >
                <a
                  className="mono inline-flex items-center gap-1.5"
                  href={buildAddressExplorerUrl(CHAIN_ID, row.backer)}
                  target="_blank"
                  rel="noreferrer"
                  title={row.backer}
                >
                  {shortAddress(row.backer)}
                  {isMe && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>You</span>}
                  <ExternalLink className="size-3" style={{ color: 'var(--subtle)' }} />
                </a>
                <span className="font-semibold tabular-nums">{money(row.amount)} USDC</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
