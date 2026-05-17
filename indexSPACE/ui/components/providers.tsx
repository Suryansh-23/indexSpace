'use client'

import { useEffect, useRef, useState } from 'react'
import { WagmiProvider, useReconnect, useAccount } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme, type Theme } from '@rainbow-me/rainbowkit'
import { config } from '@/lib/wagmi'
import { ThemeProvider } from '@/components/theme-provider'
import { ToastProvider, useToast } from '@/components/indexspace/toast-provider'
import { getUsdcAddress, getPublicClient } from '@/lib/contracts'
import { cn } from '@/lib/utils'

const queryClient = new QueryClient()

// Trigger wagmi reconnect on every page/tab mount so the wallet state
// is restored from localStorage without requiring a manual reconnect.
function AutoReconnect() {
  const { reconnect } = useReconnect()
  useEffect(() => {
    reconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

const BALANCE_OF_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const

// Fire toasts and show faucet modal on explicit wallet connect/disconnect.
// Does not fire on auto-reconnect (reconnecting → connected) — only on connecting → connected.
// Faucet modal is suppressed if the wallet already holds a non-zero USDC balance.
function WalletWatcher() {
  const { address, chainId, status } = useAccount()
  const { addToast } = useToast()
  const prevRef = useRef<string | null>(null)
  const [showFaucet, setShowFaucet] = useState(false)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status

    if (prev === null) return

    if (prev === 'connecting' && status === 'connected' && address && chainId) {
      addToast({
        message: 'WALLET CONNECTED',
        sub: `${address.slice(0, 6)}...${address.slice(-4)}`,
        color: 'green',
      })

      const usdcAddress = getUsdcAddress(chainId)
      if (usdcAddress) {
        getPublicClient(chainId).readContract({
          address: usdcAddress,
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [address],
        }).then((balance) => {
          if ((balance as bigint) === 0n) setShowFaucet(true)
        }).catch(() => {
          setShowFaucet(true)
        })
      } else {
        setShowFaucet(true)
      }
    } else if (prev === 'connected' && status === 'disconnected') {
      addToast({ message: 'WALLET DISCONNECTED', color: 'muted' })
    }
  }, [status, address, chainId, addToast])

  return <FaucetModal open={showFaucet} onClose={() => setShowFaucet(false)} />
}

function FaucetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center',
        'transition-opacity duration-300',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      {/* Overlay — darkens bg without hard blur so glass panel effect reads through */}
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />

      {/* Glass panel */}
      <div
        className={cn(
          'relative z-10 w-[520px]',
          'bg-[rgba(17,16,14,0.80)] backdrop-blur-2xl',
          'border border-ix-border-bright',
          'shadow-[0_0_0_1px_rgba(58,56,48,0.25),0_32px_80px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.04)]',
          'transition-all duration-300',
          open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-3',
        )}
      >
        {/* Top glass highlight line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ix-border">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-ix-green led-pulse shrink-0" />
            <span className="text-[8px] font-mono tracking-[0.25em] text-ix-text-faint uppercase">
              WALLET CONNECTED
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-ix-text-faint hover:text-ix-text transition-colors text-[15px] font-mono leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <p className="text-[18px] font-mono font-medium text-ix-text tracking-wide leading-tight mb-2.5">
            You need Base Sepolia USDC
          </p>
          <p className="text-[11px] font-mono text-ix-text-muted leading-relaxed mb-6">
            IndexSpace runs on Base Sepolia testnet. You&apos;ll need test USDC to
            subscribe to index vaults — get it free from Circle&apos;s faucet.
          </p>

          {/* Network info block */}
          <div className="flex items-start gap-4 bg-ix-surface border border-ix-border px-5 py-4 mb-6">
            <div className="w-1.5 h-1.5 bg-ix-yellow mt-[6px] shrink-0" />
            <div>
              <span className="text-[10px] font-mono text-ix-text-dim block tracking-[0.15em] mb-1">
                BASE SEPOLIA TESTNET
              </span>
              <span className="text-[9px] font-mono text-ix-text-faint block leading-relaxed">
                Chain ID: 84532 — test tokens only, no real value
              </span>
              <span className="text-[9px] font-mono text-ix-text-faint block leading-relaxed mt-0.5">
                Add Base Sepolia in MetaMask if it&apos;s not already listed.
              </span>
            </div>
          </div>

          {/* Primary CTA */}
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center justify-between w-full px-6 py-4 bg-ix-blue hover:bg-ix-blue-dim text-ix-shell font-mono text-[12px] uppercase tracking-[0.18em] transition-colors group"
          >
            <span>GET USDC FROM CIRCLE</span>
            <span className="text-[14px] group-hover:translate-x-0.5 transition-transform">↗</span>
          </a>

          <button
            onClick={onClose}
            className="w-full mt-2.5 py-2.5 text-[9px] font-mono text-ix-text-faint hover:text-ix-text-muted uppercase tracking-widest transition-colors"
          >
            I ALREADY HAVE USDC
          </button>
        </div>
      </div>
    </div>
  )
}

function buildTheme(): Theme {
  const base = darkTheme()
  return {
    ...base,
    blurs: { modalOverlay: 'none' },
    colors: {
      ...base.colors,
      accentColor:                    '#0071BB',
      accentColorForeground:          '#F4F1E8',
      actionButtonBorder:             '#2A2823',
      actionButtonBorderMobile:       '#2A2823',
      actionButtonSecondaryBackground:'#16150F',
      closeButton:                    '#8E8A80',
      closeButtonBackground:          '#16150F',
      connectButtonBackground:        '#0071BB',
      connectButtonBackgroundError:   '#D62D20',
      connectButtonInnerBackground:   '#11100E',
      connectButtonText:              '#F4F1E8',
      connectButtonTextError:         '#F4F1E8',
      connectionIndicator:            '#1E9E5A',
      downloadBottomCardBackground:   '#11100E',
      downloadTopCardBackground:      '#16150F',
      error:                          '#D62D20',
      generalBorder:                  '#2A2823',
      generalBorderDim:               '#1E1D1A',
      menuItemBackground:             '#16150F',
      modalBackdrop:                  'rgba(5, 5, 5, 0.88)',
      modalBackground:                '#11100E',
      modalBorder:                    '#2A2823',
      modalText:                      '#F4F1E8',
      modalTextDim:                   '#4E4A42',
      modalTextSecondary:             '#8E8A80',
      profileAction:                  '#16150F',
      profileActionHover:             '#1E1D1A',
      profileForeground:              '#11100E',
      selectedOptionBorder:           '#0071BB',
      standby:                        '#FFC700',
    },
    fonts: {
      body: "'IBM Plex Mono', 'JetBrains Mono', monospace",
    },
    radii: {
      actionButton:  '0px',
      connectButton: '0px',
      menuButton:    '0px',
      modal:         '0px',
      modalMobile:   '0px',
    },
    shadows: {
      connectButton:        'none',
      dialog:               '0 0 0 1px #2A2823, 0 8px 32px rgba(0,0,0,0.6)',
      profileDetailsAction: 'none',
      selectedOption:       '0 0 0 1px #0071BB',
      selectedWallet:       '0 0 0 1px #0071BB',
      walletLogo:           'none',
    },
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={buildTheme()}>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
            <ToastProvider>
              <AutoReconnect />
              <WalletWatcher />
              {children}
            </ToastProvider>
          </ThemeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
