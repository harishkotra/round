/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Wallet-side reads that wagmi makes on its own also go through the Anon-RPC
 * adapter (a custom transport), so nothing in the app talks to an RPC directly.
 * Mainnet (ENS) is intentionally not configured: it would need a second RPC path.
 */

import { createConfig } from 'wagmi'
import { custom } from 'viem'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { anonRpc } from './lib/anonRpc'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: custom({
      request: ({ method, params }: { method: string; params?: unknown }) =>
        anonRpc(method, Array.isArray(params) ? params : []),
    }),
  },
})
