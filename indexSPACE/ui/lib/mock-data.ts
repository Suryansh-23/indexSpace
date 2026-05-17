import { FORECAST_INDICES, LIVE_VAULT_IDS, PREVIEW_INDEX_IDS, weightSum } from '@indexspace/shared'
import type { Vault, NavPoint, ActivityEntry, Constituent } from './types'

function genNavHistory(base: number, points = 120): NavPoint[] {
  const now = Date.now()
  let nav = base
  return Array.from({ length: points }, (_, i) => {
    const drift = (Math.sin(i * 0.15) * 0.002) + (Math.cos(i * 0.07) * 0.001)
    nav = Math.max(0.9, nav * (1 + drift))
    const ts = new Date(now - (points - i) * 12 * 60 * 1000).toISOString()
    return { ts, nav: parseFloat(nav.toFixed(4)), shares: Math.floor(10000 + i * 3.2) }
  })
}

const BELIEF_MAP: Record<string, string> = {
  higher_is_bullish: 'bullish',
  lower_is_bullish: 'bearish',
  higher_is_stress: 'stress up',
  lower_is_stress: 'stress down',
}

const ROLE_GLYPH: Record<string, string> = {
  capital: '▲',
  capability: '◆',
  deployment: '⬒',
  liquidity: '●',
  macro: '⬡',
  adoption: '■',
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function buildVault(idx: typeof FORECAST_INDICES[number], index: number): Vault {
  const isLive = LIVE_VAULT_IDS.includes(idx.id as typeof LIVE_VAULT_IDS[number])
  const num = index + 1
  const label = isLive ? `VAULT ${String(num).padStart(2, '0')}` : `PREVIEW ${String(num).padStart(2, '0')}`
  const baseNav = 1.0 + (isLive ? (idx.id === 'ai-acceleration' ? 0.0847 : -0.0688) : 0)
  const h = hashId(idx.id)

  const constituents: Constituent[] = idx.constituents.map((c) => ({
    market: c.label,
    marketId: c.marketId,
    weight: c.weight,
    exposure: isLive ? `$${(baseNav * c.weight * 100).toFixed(0)}` : '—',
    belief: BELIEF_MAP[c.orientation] ?? 'neutral',
    preview: parseFloat((Math.sin(c.marketId * 0.01) * 0.15 + 0.5).toFixed(2)),
    state: isLive ? ('live' as const) : ('stale' as const),
    orientation: c.orientation,
    role: c.role,
  }))

  return {
    id: idx.id,
    number: num,
    name: idx.name.toUpperCase(),
    label,
    mode: idx.mode,
    status: isLive ? 'live' : 'preview',
    nav: parseFloat(baseNav.toFixed(4)),
    navChange: parseFloat((isLive ? ((h % 101) - 48) * 0.05 : 0).toFixed(2)),
    shares: isLive ? 10000 + (h % 40000) : 0,
    totalSupply: 100000,
    curatorState: isLive ? ('active' as const) : ('idle' as const),
    simulatorState: isLive ? ('off' as const) : ('on' as const),
    usdc: isLive ? parseFloat((baseNav * 50000).toFixed(2)) : 0,
    idleUsdc: isLive ? parseFloat((baseNav * 42000).toFixed(2)) : 0,
    fsExposure: isLive ? parseFloat((baseNav * 8000).toFixed(2)) : 0,
    claimableCount: 0,
    constituents,
    navHistory: genNavHistory(baseNav, 120),
  }
}

const _vaults = FORECAST_INDICES.map((idx, i) => buildVault(idx, i))

export const VAULTS: Vault[] = _vaults

// Static timestamps — avoids server/client hydration mismatch from Date.now() at module load
export const ACTIVITY: ActivityEntry[] = [
  { id: 'act-001', ts: '2026-05-16T10:58:00.000Z', type: 'curator', vault: 'VAULT 02', state: 'executing' },
  { id: 'act-002', ts: '2026-05-16T10:56:00.000Z', type: 'claim', vault: 'VAULT 01', amount: '512 USDC', state: 'complete', user: '0x4f2a...8c1d' },
  { id: 'act-003', ts: '2026-05-16T10:52:00.000Z', type: 'subscribe', vault: 'VAULT 01', amount: '1,000 USDC', state: 'claim_ready', user: '0x8b3e...2f9a' },
  { id: 'act-004', ts: '2026-05-16T10:45:00.000Z', type: 'redeem', vault: 'VAULT 02', amount: '250 shares', state: 'pending', user: '0x1c7d...5e0b' },
  { id: 'act-005', ts: '2026-05-16T10:38:00.000Z', type: 'curator', vault: 'VAULT 01', state: 'complete' },
  { id: 'act-006', ts: '2026-05-16T10:25:00.000Z', type: 'subscribe', vault: 'VAULT 02', amount: '750 USDC', state: 'claimed', user: '0x9a1b...3c4d' },
  { id: 'act-007', ts: '2026-05-16T10:13:00.000Z', type: 'system', vault: 'SYSTEM', state: 'info' },
]

export const TRADE_STEPS = [
  'connect wallet',
  'approve usdc',
  'request',
  'curator executing',
  'claim ready',
  'claimed',
] as const

export type TradeStep = typeof TRADE_STEPS[number]
