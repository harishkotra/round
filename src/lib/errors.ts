import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'
import { RpcRevertError } from './rpc'

const REVERTS: Record<string, string> = {
  NotOpen: 'This round is no longer open for backing.',
  DeadlinePassed: 'This round already reached its deadline.',
  ZeroAmount: 'Enter an amount greater than zero.',
  ExceedsCap: 'That would go over the most one backer can put into this round.',
  DeadlineNotReached: 'This round has not reached its deadline yet.',
  NotCreator: 'Only the person who opened this round can do that.',
  NotSettled: 'Funds are only released once a round reaches its goal.',
  AlreadyWithdrawn: 'These funds have already been collected.',
  NotRefunded: 'Refunds are only available when a round misses its goal.',
  NothingToRefund: 'You have nothing to get back from this round.',
  UnsupportedToken: 'This payment could not be processed.',
  InvariantViolated: 'This round failed a safety check, so nothing was changed.',
  InvalidDeadline: 'Pick a deadline that is in the future.',
  InvalidTarget: 'The goal must be more than zero.',
  InvalidCap: 'The per-backer limit must be more than zero.',
  EmptyTitle: 'Give your round a title.',
  InvalidCreator: 'Connect a wallet to open a round.',
  InvalidToken: 'The payment currency is not set up correctly.',
}

/** True when the user closed or rejected the wallet prompt. */
export function isUserCancel(error: unknown): boolean {
  if (error instanceof BaseError) {
    return !!error.walk((e) => e instanceof UserRejectedRequestError)
  }
  const text = error instanceof Error ? error.message.toLowerCase() : ''
  return text.includes('user rejected') || text.includes('user denied')
}

/** Turn any thrown value into one plain sentence. Returns null for a cancelled prompt. */
export function humanizeError(error: unknown): string | null {
  if (isUserCancel(error)) return null

  if (error instanceof RpcRevertError && error.errorName && REVERTS[error.errorName]) {
    return REVERTS[error.errorName]
  }

  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && REVERTS[name]) return REVERTS[name]
    }
  }

  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (text.includes('exceeds balance') || text.includes('insufficient') || text.includes('transfer amount')) {
    return 'You do not have enough USDC for that. Add some and try again.'
  }
  if (text.includes('allowance')) return 'Approve the payment first, then try again.'
  if (text.includes('chain') && text.includes('mismatch')) return 'Switch your wallet to Arc Testnet and try again.'
  if (text.includes('network') || text.includes('timeout') || text.includes('fetch')) {
    return 'Could not reach the network. Check your connection and try again.'
  }
  return 'Something went wrong, so nothing was changed. Please try again.'
}
