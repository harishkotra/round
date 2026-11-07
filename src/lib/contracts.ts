/**
 * Single place for chain, token and contract configuration.
 * - USDC address and decimals come from the generated Arc facts, never typed here.
 * - The factory address comes from VITE_ROUND_FACTORY_ADDRESS in .env.
 */
import { erc20Abi, isAddress, parseAbi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'
import { usdcDecimalsFor } from '@/onchain-money'

export const CHAIN = arcTestnet
export const CHAIN_ID = arcTestnet.id

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('USDC is not registered for Arc Testnet')

/** USDC ERC-20 interface on Arc. Native gas is the same USDC pool. */
export const USDC_ADDRESS = usdcFact.address as Address
/** Decimals of the USDC ERC-20 view, read from the facts module. */
export const USDC_DECIMALS = usdcDecimalsFor(CHAIN_ID)

const factoryEnv = import.meta.env.VITE_ROUND_FACTORY_ADDRESS as string | undefined
export const FACTORY_ADDRESS: Address | undefined =
  factoryEnv && isAddress(factoryEnv) ? factoryEnv : undefined

/** Most a single raise may target, in whole USDC. */
export const MAX_TARGET_USDC = 10_000

export const erc20 = erc20Abi

export const roundAbi = parseAbi([
  'function summary() view returns (address creator, string title, string metadataURI, uint256 target, uint64 deadline, uint256 perBackerCap, uint8 state, uint256 totalRaised, uint256 backerCount, bool withdrawn)',
  'function state() view returns (uint8)',
  'function target() view returns (uint256)',
  'function deadline() view returns (uint64)',
  'function totalRaised() view returns (uint256)',
  'function commitmentOf(address backer) view returns (uint256)',
  'function refunded(address backer) view returns (bool)',
  'function capTable() view returns (address[] backers, uint256[] amounts)',
  'function commit(uint256 amount)',
  'function close()',
  'function withdraw()',
  'function refund()',
  'error NotOpen()',
  'error DeadlinePassed()',
  'error ZeroAmount()',
  'error ExceedsCap()',
  'error UnsupportedToken()',
  'error DeadlineNotReached()',
  'error NotCreator()',
  'error NotSettled()',
  'error AlreadyWithdrawn()',
  'error NotRefunded()',
  'error NothingToRefund()',
  'error InvariantViolated()',
  'error InvalidCreator()',
  'error InvalidToken()',
  'error EmptyTitle()',
  'error InvalidTarget()',
  'error InvalidCap()',
  'error InvalidDeadline()',
])

export const factoryAbi = parseAbi([
  'function createRound(string title, string metadataURI, uint256 target, uint64 deadline, uint256 perBackerCap) returns (address)',
  'function roundCount() view returns (uint256)',
  'function roundAt(uint256 index) view returns (address)',
  'function allRounds() view returns (address[])',
  'function usdc() view returns (address)',
  'event RoundCreated(address indexed round, address indexed creator, string title, uint256 target, uint64 deadline)',
  'error InvalidToken()',
  'error NotOpen()',
  'error EmptyTitle()',
  'error InvalidTarget()',
  'error InvalidCap()',
  'error InvalidDeadline()',
  'error InvalidCreator()',
])
