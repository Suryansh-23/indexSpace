'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { parseUnits, formatUnits } from 'viem'
import type { Address } from 'viem'
import { cn } from '@/lib/utils'
import { ChevronRight, Loader } from 'lucide-react'
import type { Vault, TradeMode } from '@/lib/types'
import { TRADE_STEPS, type TradeStep } from '@/lib/mock-data'
import { getVaultAddress } from '@/lib/contracts'
import vaultAbiJson from '@/lib/IndexVault.json'
import { getVaultRequests, quoteSubscribe, quoteRedeem } from '@/lib/indexspace-api'
import { useToast } from '@/components/indexspace/toast-provider'

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

interface TradeDrawerProps {
  vault: Vault
  walletConnected: boolean
}

const STEP_COLORS: Record<TradeStep, string> = {
  'connect wallet':    '#0071BB',
  'approve usdc':      '#0071BB',
  'request':           '#0071BB',
  'curator executing': '#FFC700',
  'claim ready':       '#F05A24',
  'claimed':           '#1E9E5A',
}

const STEP_LABELS_SHORT: Record<TradeStep, string> = {
  'connect wallet':    '01 WALLET',
  'approve usdc':      '02 APPROVE',
  'request':           '03 REQUEST',
  'curator executing': '04 CURATOR',
  'claim ready':       '05 CLAIMABLE',
  'claimed':           '06 CLAIMED',
}

const STEP_HINTS: Record<TradeStep, string> = {
  'connect wallet':    'Connect your wallet to continue',
  'approve usdc':      'Authorize USDC spend for the vault',
  'request':           'Submit on-chain deposit request',
  'curator executing': 'Curator is processing your request',
  'claim ready':       'Your shares are ready to claim',
  'claimed':           'Position successfully opened',
}

export function TradeDrawer({ vault, walletConnected }: TradeDrawerProps) {
  const { address } = useAccount()
  const chainId = useChainId()
  const { openConnectModal } = useConnectModal()
  const { addToast } = useToast()

  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<TradeMode>('subscribe')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<TradeStep>('connect wallet')
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ estimatedOut: string; navPerShare: string } | null>(null)

  const { writeContract, data: txHash, isPending: isSending, reset: resetWrite } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const isLive = vault.status === 'live'
  const usdcAmount = parseFloat(amount) || 0
  const currentStepIdx = TRADE_STEPS.indexOf(step)
  const loading = isSending || isConfirming
  const effectiveWalletConnected = mounted && walletConnected

  // Resolved addresses (stable per chainId — safe to use in hooks)
  const vaultAddress = getVaultAddress(vault.id, chainId)
  const { data: vaultAsset } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'asset',
    query: {
      enabled: !!vaultAddress && mode === 'subscribe',
      staleTime: 0,
    },
  })
  const assetAddress = vaultAsset as Address | undefined

  // ── On-chain reads for state hydration ─────────────────────────────────
  // Enabled at approve and request steps so that a returning user gets
  // redirected to the correct step if an active request already exists.
  const readEnabled = !!address && !!vaultAddress && (step === 'approve usdc' || step === 'request')

  const { data: pendingDeposit, isFetching: isFetchingPendDep } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'pendingDepositRequest',
    args: address ? [0n, address] : undefined,
    query: { enabled: readEnabled, staleTime: 0 },
  })
  const { data: claimableDeposit, isFetching: isFetchingClaimDep } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'claimableDepositRequest',
    args: address ? [0n, address] : undefined,
    query: { enabled: readEnabled, staleTime: 0 },
  })
  const { data: pendingRedeem, isFetching: isFetchingPendRed } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'pendingRedeemRequest',
    args: address ? [0n, address] : undefined,
    query: { enabled: readEnabled, staleTime: 0 },
  })
  const { data: claimableRedeem, isFetching: isFetchingClaimRed } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'claimableRedeemRequest',
    args: address ? [0n, address] : undefined,
    query: { enabled: readEnabled, staleTime: 0 },
  })

  // Authoritative status check — reads the raw Request struct directly.
  // The 4 ERC-7540 reads infer status from amounts; if shares/assets are 0
  // (e.g. from a prior curator bug), they miss a stuck Claimable request and
  // allow requestDeposit to be sent even though it would revert with ActiveRequest().
  const { data: vaultRequest, isFetching: isFetchingVaultRequest } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'requests',
    args: address ? [address] : undefined,
    query: { enabled: readEnabled, staleTime: 0 },
  })

  const hydrationDone =
    pendingDeposit !== undefined &&
    claimableDeposit !== undefined &&
    pendingRedeem !== undefined &&
    claimableRedeem !== undefined &&
    vaultRequest !== undefined

  const readsStillLoading =
    readEnabled && (isFetchingPendDep || isFetchingClaimDep || isFetchingPendRed || isFetchingClaimRed || isFetchingVaultRequest)

  // USDC allowance — subscribe only; stays live at 'request' so a redirect fires
  // if allowance is 0 (consumed by prior session) before the user hits submit
  const { data: currentAllowance, isFetching: isFetchingAllowance } = useReadContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && vaultAddress ? [address, vaultAddress] : undefined,
    query: {
      enabled: !!address && !!assetAddress && !!vaultAddress && (step === 'approve usdc' || step === 'request') && usdcAmount > 0 && mode === 'subscribe',
      staleTime: 0,
    },
  })

  // Vault share balance — read at redeem steps; used for MAX button and insufficientShares check
  const { data: shareBalance } = useReadContract({
    address: vaultAddress ?? undefined,
    abi: vaultAbiJson.abi as any,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!vaultAddress && mode === 'redeem' && (step === 'approve usdc' || step === 'request'),
      staleTime: 0,
    },
  })

  const shareBalanceBigInt = shareBalance as bigint | undefined
  const insufficientShares =
    mode === 'redeem' &&
    step === 'request' &&
    shareBalanceBigInt !== undefined &&
    usdcAmount > 0 &&
    shareBalanceBigInt < parseUnits(usdcAmount.toString(), 18)

  // USDC balance — read at approve and request steps; used for MAX button and insufficientUsdc check
  const { data: usdcBalance } = useReadContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!assetAddress && mode === 'subscribe' && (step === 'approve usdc' || step === 'request'),
      staleTime: 0,
    },
  })

  const usdcBalanceBigInt = usdcBalance as bigint | undefined
  const insufficientUsdc =
    mode === 'subscribe' &&
    step === 'request' &&
    usdcBalanceBigInt !== undefined &&
    usdcAmount > 0 &&
    usdcBalanceBigInt < parseUnits(usdcAmount.toString(), 6)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Advance to next step after tx confirms and fire toast notification
  useEffect(() => {
    if (!isConfirmed) return
    if (step === 'approve usdc') {
      addToast({ message: 'USDC APPROVED', sub: `${usdcAmount.toFixed(2)} USDC authorized`, color: 'blue', txHash: txHash as string })
      setStep('request')
    } else if (step === 'request') {
      addToast({
        message: mode === 'subscribe' ? 'DEPOSIT REQUESTED' : 'REDEEM REQUESTED',
        sub: `${usdcAmount.toFixed(2)} ${mode === 'subscribe' ? 'USDC' : 'SHR'}`,
        color: mode === 'subscribe' ? 'blue' : 'orange',
        txHash: txHash as string,
      })
      setStep('curator executing')
    } else if (step === 'claim ready') {
      addToast({ message: 'CLAIMED', sub: vault.label, color: 'green', txHash: txHash as string })
      setStep('claimed')
    }
    resetWrite()
  }, [isConfirmed, step, resetWrite, addToast, txHash, usdcAmount, mode, vault.label])

  // Sync step with wallet connection state
  useEffect(() => {
    if (effectiveWalletConnected && step === 'connect wallet') {
      setStep(mode === 'subscribe' ? 'approve usdc' : 'request')
    } else if (!effectiveWalletConnected) {
      setStep('connect wallet')
    }
  }, [effectiveWalletConnected, step, mode])

  // Hydrate step from on-chain state using the raw Request struct.
  // RequestKind:   0=None, 1=Deposit, 2=Redeem
  // RequestStatus: 0=None, 1=Pending, 2=Claimable
  // Checking status directly avoids the edge case where shares/assets are 0
  // (stuck Claimable from old decimal bug) — amount-based checks would miss it.
  useEffect(() => {
    if (!vaultRequest) return
    const req = vaultRequest as readonly [number, number, bigint, bigint, bigint]
    const kind = req[0]
    const status = req[1]

    if (status === 2) { // Claimable
      setMode(kind === 1 ? 'subscribe' : 'redeem')
      setStep('claim ready')
    } else if (status === 1) { // Pending
      setMode(kind === 1 ? 'subscribe' : 'redeem')
      setStep('curator executing')
    }
  }, [vaultRequest])

  // Skip approve step if USDC is already sufficiently approved (subscribe only).
  // Guarded by hydrationDone + isFetchingAllowance so stale cached allowance
  // cannot fire the skip before fresh on-chain data has settled.
  useEffect(() => {
    if (step !== 'approve usdc' || usdcAmount <= 0 || currentAllowance == null) return
    if (!hydrationDone || readsStillLoading || isFetchingAllowance) return
    if ((currentAllowance as bigint) >= parseUnits(usdcAmount.toString(), 6)) {
      setStep('request')
    }
  }, [currentAllowance, step, usdcAmount, hydrationDone, readsStillLoading, isFetchingAllowance])

  // At the request step, verify allowance is still sufficient before allowing submit.
  // Redirects back to approve if allowance is 0 (consumed by a prior requestDeposit)
  // or if the user changed the amount after approving. Prevents the MetaMask
  // "exceeding max txn gas limit" revert from safeTransferFrom failing on-chain.
  useEffect(() => {
    if (step !== 'request' || mode !== 'subscribe' || usdcAmount <= 0 || currentAllowance == null) return
    if (isFetchingAllowance) return
    if ((currentAllowance as bigint) < parseUnits(usdcAmount.toString(), 6)) {
      setStep('approve usdc')
    }
  }, [currentAllowance, step, mode, usdcAmount, isFetchingAllowance])

  // Poll backend for curator completion when in executing state
  const pollCurator = useCallback(async () => {
    if (!address) return
    try {
      const rows = await getVaultRequests(vault.id, address)
      const claimable = rows.find((r) => r.status === 'claimable')
      if (claimable) {
        setMode(claimable.kind === 'subscribe' ? 'subscribe' : 'redeem')
        setStep('claim ready')
        addToast({ message: 'CLAIM READY', sub: vault.label, color: 'orange' })
      }
    } catch {
      // polling failure is non-fatal
    }
  }, [vault.id, vault.label, address, addToast])

  useEffect(() => {
    if (step !== 'curator executing') return
    const id = setInterval(pollCurator, 8000)
    pollCurator()
    return () => clearInterval(id)
  }, [step, pollCurator])

  // Fetch quote from backend with debounce
  useEffect(() => {
    if (usdcAmount <= 0) { setQuote(null); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        if (mode === 'subscribe') {
          const q = await quoteSubscribe(vault.id, usdcAmount)
          if (!cancelled) setQuote({
            estimatedOut: parseFloat(q.estimatedShares).toFixed(2),
            navPerShare: parseFloat(q.navPerShare).toFixed(4),
          })
        } else {
          const q = await quoteRedeem(vault.id, usdcAmount)
          if (!cancelled) setQuote({
            estimatedOut: parseFloat(q.estimatedAssets).toFixed(2),
            navPerShare: parseFloat(q.navPerShare).toFixed(4),
          })
        }
      } catch {
        // backend unavailable — fallback values already shown
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [usdcAmount, mode, vault.id])

  function resetFlowForMode(newMode: TradeMode) {
    const initialStep: TradeStep = effectiveWalletConnected
      ? (newMode === 'subscribe' ? 'approve usdc' : 'request')
      : 'connect wallet'
    setStep(initialStep)
    setAmount('')
    setQuote(null)
    setError(null)
    resetWrite()
  }

  function resetFlow() {
    resetFlowForMode(mode)
  }

  async function handleAction() {
    setError(null)
    try {
      if (step === 'connect wallet') {
        openConnectModal?.()
        return
      }

      if (!vaultAddress) throw new Error('Vault not deployed on this network')

      if (step === 'approve usdc') {
        if (!assetAddress) throw new Error('Vault asset address unavailable on this network')
        const approveAmt = mode === 'subscribe'
          ? parseUnits(usdcAmount.toString(), 6)
          : parseUnits((usdcAmount * vault.nav * 1.01).toFixed(6), 6)
        writeContract({
          address: assetAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress, approveAmt],
          account: address as Address,
        })
        return
      }

      if (step === 'request') {
        if (!address) return
        if (mode === 'subscribe') {
          writeContract({
            address: vaultAddress,
            abi: vaultAbiJson.abi as any,
            functionName: 'requestDeposit',
            args: [parseUnits(usdcAmount.toString(), 6), address, address],
            account: address,
          })
        } else {
          writeContract({
            address: vaultAddress,
            abi: vaultAbiJson.abi as any,
            functionName: 'requestRedeem',
            args: [parseUnits(usdcAmount.toString(), 18), address, address],
            account: address,
          })
        }
        return
      }

      if (step === 'claim ready') {
        if (!address) return
        const fn = mode === 'subscribe' ? 'claimDeposit' : 'claimRedeem'
        writeContract({
          address: vaultAddress,
          abi: vaultAbiJson.abi as any,
          functionName: fn,
          args: [address, address],
          account: address,
        })
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const canAdvance =
    step !== 'claimed' &&
    step !== 'curator executing' &&
    !loading &&
    !readsStillLoading &&
    !insufficientShares &&
    !insufficientUsdc &&
    (step === 'connect wallet' || step === 'claim ready' || usdcAmount > 0)

  const actionLabel: Record<TradeStep, string> = {
    'connect wallet':    'CONNECT WALLET',
    'approve usdc':      'APPROVE USDC',
    'request':           mode === 'subscribe' ? 'SUBMIT REQUEST' : 'SUBMIT REDEMPTION',
    'curator executing': 'AWAITING CURATOR',
    'claim ready':       'CLAIM NOW',
    'claimed':           'CLAIMED',
  }

  const actionColor: Partial<Record<TradeStep, string>> = {
    'connect wallet':    'bg-ix-blue hover:bg-ix-blue-dim text-ix-shell',
    'approve usdc':      'bg-ix-blue hover:bg-ix-blue-dim text-ix-shell',
    'request':           mode === 'subscribe'
                           ? 'bg-ix-blue hover:bg-ix-blue-dim text-ix-shell'
                           : 'bg-ix-orange hover:opacity-90 text-ix-shell',
    'curator executing': 'bg-ix-panel text-ix-text-faint cursor-not-allowed',
    'claim ready':       'bg-ix-orange hover:opacity-90 text-ix-shell',
    'claimed':           'bg-ix-panel text-ix-text-faint cursor-not-allowed',
  }

  // Quote values — prefer backend response, fall back to local math
  const estimateValue = quote
    ? quote.estimatedOut
    : usdcAmount > 0
      ? mode === 'subscribe'
        ? (usdcAmount / vault.nav).toFixed(2)
        : (usdcAmount * vault.nav).toFixed(2)
      : '—'
  const navUsed = quote?.navPerShare ?? vault.nav.toFixed(4)

  return (
    <aside className="w-[264px] bg-ix-shell border-l border-ix-border flex flex-col shrink-0 overflow-y-auto">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ix-border">
        <span className="text-[8px] font-mono tracking-[0.25em] text-ix-text-faint uppercase">TRADE</span>
        <span className="text-[8px] font-mono text-ix-text-faint">{vault.label}</span>
      </div>

      {/* ── Mode selector ─────────────────────────────────────────────────── */}
      <div className="flex border-b border-ix-border">
        {(['subscribe', 'redeem'] as TradeMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); resetFlowForMode(m) }}
            className={cn(
              'flex-1 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] border-r last:border-r-0 border-ix-border transition-colors',
              mode === m
                ? m === 'subscribe'
                  ? 'bg-ix-blue text-ix-shell font-medium'
                  : 'bg-ix-orange text-ix-shell font-medium'
                : 'text-ix-text-faint hover:text-ix-text-muted hover:bg-ix-panel-warm'
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {/* ── Vault target block ────────────────────────────────────────────── */}
      <div className="px-4 py-3.5 border-b border-ix-border">
        <span className="text-[8px] font-mono tracking-[0.22em] text-ix-text-faint uppercase block mb-2">TARGET VAULT</span>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[13px] font-mono text-ix-text font-medium leading-none mb-1">{vault.label}</div>
            <div className="text-[10px] font-mono text-ix-text-muted">{vault.name}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono tabular text-ix-text-dim leading-none">NAV</div>
            <div className="text-[16px] font-mono tabular text-ix-text font-medium leading-none mt-1">{vault.nav.toFixed(4)}</div>
          </div>
        </div>
        {!isLive && (
          <div className="mt-2 text-[8px] font-mono text-ix-orange uppercase tracking-[0.2em]">
            preview only — not tradeable
          </div>
        )}
        {vaultAddress && chainId === 84532 && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="text-[7px] font-mono text-ix-text-faint tracking-[0.18em] uppercase">CONTRACT</span>
            <a
              href={`https://sepolia.basescan.org/address/${vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[7px] font-mono text-ix-blue hover:underline tabular"
            >
              {vaultAddress.slice(0, 6)}...{vaultAddress.slice(-4)}
            </a>
          </div>
        )}
      </div>

      {/* ── Amount input ──────────────────────────────────────────────────── */}
      {isLive && (
        <div className="px-4 py-3.5 border-b border-ix-border">
          <label className="text-[8px] font-mono tracking-[0.22em] text-ix-text-faint uppercase block mb-2">
            {mode === 'subscribe' ? 'USDC AMOUNT' : 'SHARES TO REDEEM'}
          </label>
          <div className="flex items-center border border-ix-border bg-ix-panel-warm focus-within:border-ix-blue transition-colors">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              disabled={step === 'curator executing' || step === 'claim ready' || step === 'claimed'}
              className="flex-1 bg-transparent px-3 py-3 text-[22px] font-mono tabular text-ix-text placeholder:text-ix-text-faint outline-none w-0 disabled:opacity-40"
            />
            <span className="px-3 text-[9px] font-mono text-ix-text-faint uppercase tracking-widest shrink-0 border-l border-ix-border py-3">
              {mode === 'subscribe' ? 'USDC' : 'SHR'}
            </span>
          </div>
          {/* Balance + MAX — only shown when balance is loaded and input is active */}
          {!(step === 'curator executing' || step === 'claim ready' || step === 'claimed') &&
            (mode === 'subscribe' ? usdcBalanceBigInt : shareBalanceBigInt) !== undefined && (
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[8px] font-mono text-ix-text-faint">
                BAL:{' '}
                {mode === 'subscribe'
                  ? `${parseFloat(formatUnits(usdcBalanceBigInt!, 6)).toFixed(2)} USDC`
                  : `${parseFloat(formatUnits(shareBalanceBigInt!, 18)).toFixed(4)} SHR`}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (mode === 'subscribe' && usdcBalanceBigInt !== undefined)
                    setAmount(formatUnits(usdcBalanceBigInt, 6))
                  else if (mode === 'redeem' && shareBalanceBigInt !== undefined)
                    setAmount(formatUnits(shareBalanceBigInt, 18))
                }}
                className="text-[8px] font-mono text-ix-blue hover:text-ix-blue-dim uppercase tracking-wider"
              >
                MAX
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Quote preview ─────────────────────────────────────────────────── */}
      {isLive && (
        <div className="px-4 py-3 border-b border-ix-border">
          <span className="text-[8px] font-mono tracking-[0.22em] text-ix-text-faint uppercase block mb-2">QUOTE PREVIEW</span>
          <QuoteRow label="NAV USED" value={navUsed} />
          {mode === 'subscribe'
            ? <QuoteRow label="EST. SHARES" value={estimateValue} accent="text-ix-text" />
            : <QuoteRow label="EST. USDC OUT" value={estimateValue} accent="text-ix-text" />}
          <QuoteRow label="EXEC WINDOW" value="~15 min" />
        </div>
      )}

      {/* ── Request lifecycle ─────────────────────────────────────────────── */}
      {isLive && (
        <div className="border-b border-ix-border">
          {/* Section header + progress bar */}
          <div className="px-4 pt-3.5 pb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] font-mono tracking-[0.22em] text-ix-text-faint uppercase">REQUEST STATE</span>
              <span className="text-[8px] font-mono tabular text-ix-text-faint">
                {currentStepIdx + 1} / {TRADE_STEPS.length}
              </span>
            </div>
            {/* Segmented progress bar */}
            <div className="flex gap-[2px]">
              {TRADE_STEPS.map((s, i) => {
                const done   = i < currentStepIdx
                const active = s === step
                return (
                  <div
                    key={s}
                    className="flex-1 h-[2px] transition-colors duration-300"
                    style={{
                      backgroundColor: done
                        ? '#1E9E5A'
                        : active
                          ? STEP_COLORS[s]
                          : '#2A2823',
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* Steps */}
          <div className="flex flex-col pb-1">
            {TRADE_STEPS.map((s, i) => {
              const done   = i < currentStepIdx
              const active = s === step
              const color  = STEP_COLORS[s]
              const [num, ...labelParts] = STEP_LABELS_SHORT[s].split(' ')
              const label = labelParts.join(' ')

              return (
                <div
                  key={s}
                  className={cn(
                    'relative flex items-start gap-3 px-4 py-[7px] transition-colors',
                    active ? 'bg-ix-panel-warm' : ''
                  )}
                >
                  {/* Left accent bar for active */}
                  {active && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[2px]"
                      style={{ backgroundColor: color }}
                    />
                  )}

                  {/* Connector line */}
                  {i < TRADE_STEPS.length - 1 && (
                    <div
                      className="absolute left-[19px] top-[22px] w-px"
                      style={{
                        bottom: '-7px',
                        backgroundColor: done ? '#1E9E5A' : '#2A2823',
                      }}
                    />
                  )}

                  {/* Step indicator */}
                  <div
                    className={cn(
                      'w-[10px] h-[10px] mt-[1px] shrink-0 flex items-center justify-center relative z-10 border transition-colors',
                      done   ? 'bg-ix-green border-ix-green' :
                      active ? 'border-current bg-ix-shell' : 'border-ix-border bg-ix-shell'
                    )}
                    style={active && !done ? { borderColor: color } : {}}
                  >
                    {done && <span className="text-ix-shell" style={{ fontSize: 7, lineHeight: 1 }}>✓</span>}
                    {active && s === 'curator executing' && (
                      <Loader size={6} className="animate-spin" style={{ color }} />
                    )}
                    {active && s !== 'curator executing' && (
                      <div className="w-[4px] h-[4px]" style={{ backgroundColor: color }} />
                    )}
                  </div>

                  {/* Label */}
                  <div className="flex flex-col gap-[2px] min-w-0">
                    <div className="flex items-baseline gap-[5px]">
                      <span
                        className="text-[8px] font-mono tabular leading-none"
                        style={{ color: done ? '#1E9E5A' : active ? color : '#2A2823' }}
                      >
                        {num}
                      </span>
                      <span
                        className="text-[10px] font-mono tracking-[0.14em] leading-none"
                        style={{ color: done ? '#1E9E5A' : active ? color : '#4E4A42' }}
                      >
                        {label}
                      </span>
                    </div>
                    {active && (
                      <span className="text-[8px] font-mono text-ix-text-faint leading-snug mt-[2px]">
                        {STEP_HINTS[s]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Error display ─────────────────────────────────────────────────── */}
      {(error || insufficientShares || insufficientUsdc) && (
        <div className="px-4 py-2 border-b border-ix-border">
          {insufficientShares && (
            <p className="text-[9px] font-mono text-ix-red leading-relaxed">Insufficient vault shares</p>
          )}
          {insufficientUsdc && (
            <p className="text-[9px] font-mono text-ix-red leading-relaxed">Insufficient USDC balance</p>
          )}
          {error && (
            <p className="text-[9px] font-mono text-ix-red leading-relaxed break-all">{error}</p>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* ── Action button ─────────────────────────────────────────────────── */}
      <div className="p-4 border-t border-ix-border">
        {isLive ? (
          <>
            <button
              onClick={handleAction}
              disabled={!canAdvance}
              className={cn(
                'w-full py-3.5 text-[11px] font-mono uppercase tracking-[0.18em] transition-colors flex items-center justify-center gap-2',
                canAdvance
                  ? actionColor[step] ?? 'bg-ix-blue text-ix-shell'
                  : 'bg-ix-panel text-ix-text-faint cursor-not-allowed'
              )}
            >
              {loading
                ? <><Loader size={12} className="animate-spin" /> processing...</>
                : <>{actionLabel[step]}{canAdvance && <ChevronRight size={12} />}</>}
            </button>
            {step === 'claimed' && (
              <button
                onClick={resetFlow}
                className="w-full mt-2 py-2 text-[10px] font-mono uppercase tracking-widest text-ix-text-muted hover:text-ix-text transition-colors text-center"
              >
                NEW REQUEST
              </button>
            )}
          </>
        ) : (
          <div className="w-full py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-ix-text-faint text-center border border-ix-border">
            PREVIEW ONLY / NOT TRADEABLE
          </div>
        )}
      </div>
    </aside>
  )
}

function QuoteRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ix-border-dim last:border-b-0">
      <span className="text-[8px] font-mono tracking-[0.18em] text-ix-text-faint uppercase">{label}</span>
      <span className={cn('text-[10px] font-mono tabular', accent ?? 'text-ix-text-muted')}>
        {value}
      </span>
    </div>
  )
}
