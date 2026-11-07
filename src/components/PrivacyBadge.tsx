import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EyeOff, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { anonRpc, DIRECT_MODE } from '@/lib/anonRpc'
import { resetRpcStats, useChannel, useRpcStats, type DirectReason } from '@/lib/rpcStats'

const REASON_COPY: Record<DirectReason, { label: string; expected: boolean }> = {
  specifier: { label: 'Finding and verifying the anonymizer (Ethereum mainnet registry)', expected: true },
  'dev-flag': { label: 'Direct-mode flag ?direct=1', expected: false },
  'not-ready': { label: 'Private channel was not ready in time', expected: false },
  'retries-failed': { label: 'Private channel failed 3 times', expected: false },
  'worker-unavailable': { label: 'Private channel could not start', expected: false },
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; block: string; ms: number; route?: 'anon' | DirectReason }
  | { kind: 'error'; message: string }

export function PrivacyBadge() {
  const stats = useRpcStats()
  const channel = useChannel()
  const [open, setOpen] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const ref = useRef<HTMLDivElement>(null)

  /** One eth_blockNumber through the normal transport. Counted like any other read. */
  async function runTest() {
    setTest({ kind: 'running' })
    const started = performance.now()
    const seen: { route?: 'anon' | DirectReason } = {}
    try {
      const result = await anonRpc('eth_blockNumber', [], (route) => {
        seen.route = route
      })
      setTest({
        kind: 'ok',
        block: BigInt(String(result)).toString(),
        ms: Math.round(performance.now() - started),
        route: seen.route,
      })
    } catch (e) {
      setTest({ kind: 'error', message: e instanceof Error ? e.message : 'The test failed' })
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const total = stats.anon + stats.direct
  const pct = total === 0 ? 0 : Math.round((stats.anon / total) * 100)
  const status = channel.status

  // Only claim anonymization while the private channel is actually up.
  const label =
    status === 'connecting'
      ? 'Establishing private channel…'
      : status === 'ready'
        ? total === 0
          ? 'Private channel ready'
          : `${stats.anon}/${total} reads anonymized (${pct}%)`
        : status === 'bypassed'
          ? 'Direct mode: reads NOT anonymized'
          : 'Private channel unavailable: reads are direct'

  const tone =
    status === 'ready'
      ? { fg: 'var(--success)', bg: 'rgba(26,128,71,0.12)' }
      : status === 'connecting'
        ? { fg: 'var(--accent-hover)', bg: 'rgba(16,97,166,0.10)' }
        : { fg: 'var(--danger)', bg: 'rgba(186,43,76,0.10)' }

  const Icon = status === 'ready' ? ShieldCheck : status === 'connecting' ? Loader2 : ShieldAlert

  const unexpectedDirect = (Object.keys(stats.directReasons) as DirectReason[]).filter(
    (r) => !REASON_COPY[r].expected && stats.directReasons[r] > 0,
  )

  return (
    <>
      {DIRECT_MODE && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[9997] py-1 text-center text-xs font-semibold"
          style={{ background: 'var(--danger)', color: '#fff' }}
        >
          Direct mode (?direct=1): reads are sent directly and are NOT anonymized
        </div>
      )}
      <div ref={ref} className="fixed bottom-4 left-4 z-[9998] max-w-[calc(100vw-2rem)]">
        <AnimatePresence>
          {open && (
            <motion.section
              role="dialog"
              aria-label="Privacy details"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="card mb-2 w-[340px] max-w-full p-4"
              style={{ background: 'var(--surface-strong)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="display text-base font-bold">Private reads</h2>
                  <p className="mt-0.5 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                    Rounds, balances and backers are fetched through the Ethereum Foundation&apos;s Anon-RPC, so the
                    network provider cannot tie them to your IP address.
                  </p>
                </div>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg p-1.5" style={{ color: 'var(--muted)' }}>
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: tone.bg, color: tone.fg }}>
                {status === 'ready' && 'Private channel is up'}
                {status === 'connecting' && 'Establishing private channel. Reads wait for it and nothing is sent early.'}
                {status === 'unavailable' && `Private channel unavailable. Reads are going direct and are not anonymized.${channel.detail ? ` (${channel.detail})` : ''}`}
                {status === 'bypassed' && 'Bypassed by the ?direct=1 flag. Reads are not anonymized.'}
              </div>

              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                {status === 'ready' && channel.gateway
                  ? `Gateway: ${channel.gateway}`
                  : status === 'connecting'
                    ? 'Gateway: connecting…'
                    : 'No gateway reachable'}
              </p>

              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="inline-flex items-center gap-1.5"><EyeOff className="size-3.5" /> Through Anon-RPC</dt>
                  <dd className="font-semibold tabular-nums">{stats.anon}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Direct requests</dt>
                  <dd className="font-semibold tabular-nums">{stats.direct}</dd>
                </div>
                {(Object.keys(stats.directReasons) as DirectReason[])
                  .filter((r) => stats.directReasons[r] > 0)
                  .map((r) => (
                    <div key={r} className="flex items-start justify-between gap-3 pl-4 text-xs" style={{ color: REASON_COPY[r].expected ? 'var(--muted)' : 'var(--danger)' }}>
                      <span className="text-pretty">
                        {REASON_COPY[r].label}
                        {REASON_COPY[r].expected ? ' (expected)' : ' (not expected)'}
                      </span>
                      <span className="font-semibold tabular-nums">{stats.directReasons[r]}</span>
                    </div>
                  ))}
                <div className="flex items-center justify-between">
                  <dt>Failed private attempts</dt>
                  <dd className="font-semibold tabular-nums">{stats.anon_failed}</dd>
                </div>
              </dl>

              {unexpectedDirect.length > 0 && (
                <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                  Some reads were sent directly after the private channel failed. They were not anonymized.
                </p>
              )}

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={test.kind === 'running'}
                  className="btn-ghost !min-h-9 !px-3 text-xs"
                >
                  {test.kind === 'running' ? 'Testing…' : 'Test private channel'}
                </button>
                {test.kind === 'ok' && (
                  <p
                    role="status"
                    className="mt-2 text-xs font-semibold text-pretty"
                    style={{ color: test.route === 'anon' ? 'var(--success)' : 'var(--danger)' }}
                  >
                    Block {test.block} in {test.ms} ms
                    {test.route === 'anon'
                      ? ', through Anon-RPC.'
                      : test.route
                        ? `, sent directly and not anonymized (${REASON_COPY[test.route].label}).`
                        : '.'}
                  </p>
                )}
                {test.kind === 'error' && (
                  <p role="alert" className="mt-2 text-xs font-semibold text-pretty" style={{ color: 'var(--danger)' }}>
                    Test failed: {test.message}
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
                One direct request is expected: the app reads Ethereum mainnet once to find and verify the anonymizer
                before it can use it. Transactions you sign go through your wallet&apos;s own connection, not Anon-RPC.
              </p>
              <button type="button" onClick={resetRpcStats} className="mt-2 text-xs font-semibold underline" style={{ color: 'var(--muted)' }}>
                Reset counters
              </button>
            </motion.section>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-xs font-semibold"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 4px 20px rgba(18,45,69,0.12)',
            color: 'var(--ink)',
          }}
        >
          <span className="flex size-6 items-center justify-center rounded-full" style={{ background: tone.bg, color: tone.fg }}>
            <Icon className={status === 'connecting' ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </span>
          <span className="tabular-nums">{label}</span>
        </button>
      </div>
    </>
  )
}
