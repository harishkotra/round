import { ConnectKitButton } from 'connectkit'
import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link to="/" className="flex items-center gap-2" aria-label="Round home">
        <span className="flex size-9 items-center justify-center rounded-full" style={{ background: 'var(--accent)' }}>
          <span className="size-3.5 rounded-full border-2 border-white" />
        </span>
        <span className="display text-xl font-bold">Round</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link to="/new" className="btn-ghost hidden sm:inline-flex">
          Start a round
        </Link>
        <ConnectKitButton label="Connect wallet" />
      </div>
    </header>
  )
}
