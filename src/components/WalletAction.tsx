import type { ReactNode } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import type { TxPhase } from '@/hooks/useTx'
import { CHAIN_ID } from '@/lib/contracts'
import { Spinner } from './ui'

const PHASE_LABEL: Record<TxPhase, string> = {
  idle: '',
  switching: 'Switching network…',
  signing: 'Confirm in your wallet…',
  confirming: 'Confirming…',
}

/** Primary action button that handles connect / wrong network / pending states. */
export function WalletAction({
  label,
  onClick,
  phase,
  disabled,
  variant = 'primary',
  extraBusyLabel,
  submit,
}: {
  label: ReactNode
  onClick?: () => void
  phase: TxPhase
  disabled?: boolean
  variant?: 'primary' | 'ghost'
  extraBusyLabel?: string
  submit?: boolean
}) {
  const { isConnected } = useAccount()
  const cls = variant === 'primary' ? 'btn-primary w-full' : 'btn-ghost w-full'

  if (!isConnected) {
    return (
      <ConnectKitButton.Custom>
        {({ show }) => (
          <button type="button" className={cls} onClick={show}>
            Connect wallet to continue
          </button>
        )}
      </ConnectKitButton.Custom>
    )
  }

  const busy = phase !== 'idle'
  return (
    <button type={submit ? 'submit' : 'button'} className={cls} onClick={onClick} disabled={disabled || busy}>
      {busy ? <Spinner label={extraBusyLabel ?? PHASE_LABEL[phase]} /> : label}
    </button>
  )
}

export function useOnArc(): boolean {
  const { chainId } = useAccount()
  return chainId === CHAIN_ID
}
