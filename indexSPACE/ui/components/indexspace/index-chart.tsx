'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { NavPoint, Vault } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useState, useEffect, useMemo, useRef } from 'react'
import { getVaultCandles } from '@/lib/indexspace-api'

// ── Client-side OU walk — mirrors candles.ts parameters exactly ──────────────
const NAV_MEAN = 100.0
const NAV_FLOOR = 82.0
const NAV_CEIL = 140.0
const THETA_5MIN = 0.004 / 12
const STEP_VOL_5MIN = 0.18 / Math.sqrt(12)
const MIN5_MS = 5 * 60 * 1000

function lcgRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function hashStr(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

// Generates deterministic synthetic 5-min candles from anchor up to the current
// 5-min bucket boundary. Seeded per-vault so the walk is stable across renders.
function generateSyntheticForward(anchor: NavPoint, vaultId: string): NavPoint[] {
  const anchorTs = new Date(anchor.ts).getTime()
  const now = Date.now()
  if (anchorTs >= now) return []

  const rng = lcgRand(hashStr(`${vaultId}:live:${anchorTs}`))
  const points: NavPoint[] = []
  let nav = anchor.nav

  const nowBucket = Math.floor(now / MIN5_MS) * MIN5_MS
  for (let ts = anchorTs + MIN5_MS; ts <= nowBucket; ts += MIN5_MS) {
    const drift = THETA_5MIN * (NAV_MEAN - nav)
    const shock = (rng() - 0.5) * 2 * STEP_VOL_5MIN
    nav = Math.max(NAV_FLOOR, Math.min(NAV_CEIL, nav + drift + shock))
    points.push({ ts: new Date(ts).toISOString(), nav: parseFloat(nav.toFixed(6)), shares: anchor.shares })
  }

  return points
}

type Range = '1H' | '6H' | '1D' | 'ALL'
type ChartMode = 'NAV' | 'INDEX'

const RANGES: Range[] = ['1H', '6H', '1D', 'ALL']

const RANGE_MS: Record<Range, number> = {
  '1H': 60 * 60 * 1000,
  '6H': 6 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  'ALL': Infinity,
}

function sliceHistory(data: NavPoint[], range: Range): NavPoint[] {
  if (range === 'ALL') return data
  const cutoff = Date.now() - RANGE_MS[range]
  return data.filter((d) => new Date(d.ts).getTime() >= cutoff)
}

interface IndexChartProps {
  vault: Vault
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as NavPoint
  return (
    <div className="bg-ix-shell border border-ix-border px-3 py-2">
      <div className="text-[8px] font-mono text-ix-text-faint mb-1 tracking-wider">
        {new Date(d.ts).toLocaleTimeString('en-US', { hour12: false })}
      </div>
      <div className="text-[13px] font-mono tabular text-ix-text">
        {d.nav.toFixed(4)}
      </div>
      <div className="text-[9px] font-mono tabular text-ix-text-muted mt-0.5">
        {d.shares.toLocaleString()} shares
      </div>
    </div>
  )
}

export function IndexChart({ vault }: IndexChartProps) {
  const [range, setRange] = useState<Range>('1D')
  const [mode, setMode] = useState<ChartMode>('NAV')
  const [liveHistory, setLiveHistory] = useState<NavPoint[] | null>(null)
  const [streamPoints, setStreamPoints] = useState<NavPoint[]>([])
  const streamAnchorRef = useRef<NavPoint | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchCandles() {
      const candles = await getVaultCandles(vault.id)
      if (cancelled || !candles.length) return
      setLiveHistory(candles as NavPoint[])
    }

    fetchCandles()
    const id = setInterval(fetchCandles, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [vault.id])

  // historicalPoints: real backend candles + deterministic synthetic fill up to now
  const historicalPoints = useMemo(() => {
    const base = (liveHistory ?? vault.navHistory) as NavPoint[]
    if (!base.length) return base
    const synthetic = generateSyntheticForward(base[base.length - 1], vault.id)
    return [...base, ...synthetic]
  }, [liveHistory, vault.id])

  // Seed streaming anchor from the end of historical data; reset stream on data change
  useEffect(() => {
    streamAnchorRef.current = historicalPoints[historicalPoints.length - 1] ?? null
    setStreamPoints([])
  }, [historicalPoints])

  // Append one OU micro-step per second — drives real-time chart movement
  useEffect(() => {
    const SEC_THETA = THETA_5MIN / 300
    const SEC_VOL = (STEP_VOL_5MIN / Math.sqrt(300)) * 2

    const id = setInterval(() => {
      setStreamPoints(prev => {
        const anchor = prev.length > 0 ? prev[prev.length - 1] : streamAnchorRef.current
        if (!anchor) return prev
        const nav = anchor.nav
        const drift = SEC_THETA * (NAV_MEAN - nav)
        const shock = (Math.random() - 0.5) * 2 * SEC_VOL
        const newNav = Math.max(NAV_FLOOR, Math.min(NAV_CEIL, nav + drift + shock))
        return [...prev.slice(-599), {
          ts: new Date().toISOString(),
          nav: parseFloat(newNav.toFixed(6)),
          shares: anchor.shares,
        }]
      })
    }, 1000)

    return () => clearInterval(id)
  }, [])

  const data = sliceHistory([...historicalPoints, ...streamPoints], range)
  const isUp = vault.navChange >= 0
  const isPreview = vault.status === 'preview'
  const lineColor = isPreview ? '#F05A24' : isUp ? '#1E9E5A' : '#D62D20'
  const minNav = Math.min(...data.map((d) => d.nav))
  const maxNav = Math.max(...data.map((d) => d.nav))
  const navPad = Math.max((maxNav - minNav) * 0.2, 0.002)

  return (
    <div className="flex flex-col h-full bg-ix-panel">

      {/* ── Chart identity header ─────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-0 shrink-0">
        <div className="flex items-start justify-between">
          {/* Left: vault identity + NAV headline */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-mono tracking-[0.22em] text-ix-text-faint uppercase">
                {vault.label}
              </span>
              <span className="text-ix-border-bright font-mono text-[9px]">/</span>
              <span className="text-[9px] font-mono tracking-widest text-ix-text-muted uppercase">
                {vault.name}
              </span>
              {isPreview && (
                <span className="text-[8px] font-mono text-ix-orange border border-ix-orange px-1.5 py-px tracking-widest">
                  SIMULATOR ON
                </span>
              )}
            </div>

            {/* NAV headline */}
            <div className="flex items-baseline gap-3">
              <span className="text-[32px] font-mono tabular font-medium text-ix-text leading-none">
                {vault.nav.toFixed(4)}
              </span>
              <div className="flex flex-col gap-[3px]">
                <span
                  className="text-[13px] font-mono tabular leading-none"
                  style={{ color: vault.navChange === 0 ? '#4E4A42' : isUp ? '#1E9E5A' : '#D62D20' }}
                >
                  {vault.navChange === 0
                    ? '0.00%'
                    : `${isUp ? '+' : ''}${vault.navChange.toFixed(2)}%`}
                </span>
                <span className="text-[8px] font-mono text-ix-text-faint tracking-widest uppercase">24H CHANGE</span>
              </div>
            </div>
          </div>

          {/* Right: stat cells */}
          <div className="flex items-start gap-px">
            <ChartStatCell label="GROSS NAV" value={vault.nav.toFixed(4)} />
            <ChartStatCell label="IDLE USDC" value={`$${vault.idleUsdc.toFixed(0)}`} />
            <ChartStatCell label="FS EXPOSURE" value={`$${vault.fsExposure.toFixed(0)}`} />
            <ChartStatCell
              label="CLAIMABLE"
              value={String(vault.claimableCount)}
              accent={vault.claimableCount > 0 ? 'text-ix-orange' : undefined}
            />
          </div>
        </div>
      </div>

      {/* ── Chart controls ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2 mt-2 border-t border-b border-ix-border-dim shrink-0">
        {/* Range selector */}
        <div className="flex items-center gap-px">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors',
                range === r
                  ? 'bg-ix-blue text-ix-shell'
                  : 'text-ix-text-muted hover:text-ix-text'
              )}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-px">
          {(['NAV', 'INDEX'] as ChartMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors border',
                mode === m
                  ? 'border-ix-border-bright text-ix-text-dim'
                  : 'border-transparent text-ix-text-faint hover:text-ix-text-muted'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart canvas ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-1 pt-2 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`navGrad-${vault.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="75%" stopColor={lineColor} stopOpacity={0.04} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="#1E1D1A"
              strokeWidth={1}
            />
            <XAxis
              dataKey="ts"
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
              }
              tick={{ fill: '#4E4A42', fontSize: 8, fontFamily: 'IBM Plex Mono, monospace' }}
              axisLine={{ stroke: '#2A2823' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minNav - navPad, maxNav + navPad]}
              tick={{ fill: '#4E4A42', fontSize: 8, fontFamily: 'IBM Plex Mono, monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(4)}
              width={54}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="nav"
              stroke={lineColor}
              strokeWidth={1.5}
              fill={`url(#navGrad-${vault.id})`}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 3, fill: lineColor, stroke: '#050505', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartStatCell({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-[3px] px-3 border-l border-ix-border-dim">
      <span className="text-[8px] font-mono tracking-[0.18em] text-ix-text-faint uppercase leading-none">
        {label}
      </span>
      <span className={cn('text-[11px] font-mono tabular leading-none', accent ?? 'text-ix-text-dim')}>
        {value}
      </span>
    </div>
  )
}
