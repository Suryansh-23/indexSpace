'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import type { ActivityEntry } from '@/lib/types'

interface ActivityStripProps {
  entries: ActivityEntry[]
}

const TYPE_CONFIG: Record<string, { tag: string; bg: string; text: string }> = {
  subscribe: { tag: 'SUB', bg: 'bg-ix-blue',         text: 'text-ix-shell' },
  redeem:    { tag: 'RDM', bg: 'bg-ix-orange',        text: 'text-ix-shell' },
  claim:     { tag: 'CLM', bg: 'bg-ix-green',         text: 'text-ix-shell' },
  curator:   { tag: 'CUR', bg: 'bg-ix-yellow',        text: 'text-ix-shell' },
  system:    { tag: 'SIM', bg: 'bg-ix-text-faint',    text: 'text-ix-shell' },
}

const STATE_COLOR: Record<string, string> = {
  executing:  'text-ix-yellow',
  pending:    'text-ix-blue',
  claim_ready:'text-ix-orange',
  claimed:    'text-ix-green',
  complete:   'text-ix-green',
  failed:     'text-ix-red',
  info:       'text-ix-text-faint',
  none:       'text-ix-text-faint',
}

export function ActivityStrip({ entries }: ActivityStripProps) {
  const duration = Math.max(20, entries.length * 5)

  return (
    <footer className="h-8 bg-ix-shell border-t border-ix-border flex items-stretch shrink-0 overflow-hidden">

      {/* Label */}
      <div className="flex items-center gap-2 px-4 border-r border-ix-border shrink-0">
        <div className="w-[5px] h-[5px] bg-ix-green led-pulse" />
        <span className="text-[8px] font-mono tracking-[0.25em] text-ix-text-faint uppercase">LIVE TAPE</span>
      </div>

      {/* Marquee entries */}
      <div className="flex-1 overflow-hidden">
        {entries.length > 0 ? (
          <div
            className="marquee-track"
            style={{ '--marquee-duration': `${duration}s` } as React.CSSProperties}
          >
            {entries.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
            {entries.map((entry) => (
              <ActivityItem key={`_${entry.id}`} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="flex items-center h-full px-4">
            <span className="text-[9px] font-mono text-ix-text-faint">NO ACTIVITY</span>
          </div>
        )}
      </div>

      {/* Network tag */}
      <div className="flex items-center gap-2 px-4 border-l border-ix-border shrink-0">
        <span className="text-[8px] font-mono text-ix-yellow uppercase tracking-widest">BASE SEPOLIA</span>
      </div>
    </footer>
  )
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.system
  const relTime = getRelTime(entry.ts)

  return (
    <div className="flex items-center gap-2 px-3.5 border-r border-ix-border-dim shrink-0 h-full hover:bg-ix-panel-warm transition-colors">
      {/* Type badge */}
      <span className={cn('text-[8px] font-mono font-medium px-1.5 py-[2px] leading-none tracking-wider', cfg.bg, cfg.text)}>
        {cfg.tag}
      </span>

      {/* Vault */}
      <span className="text-[9px] font-mono text-ix-text-muted">{entry.vault}</span>

      {/* Amount */}
      {entry.amount && (
        <span className="text-[9px] font-mono tabular text-ix-text-dim">{entry.amount}</span>
      )}

      {/* User */}
      {entry.user && (
        <span className="text-[8px] font-mono text-ix-text-faint">{entry.user}</span>
      )}

      {/* State */}
      <span className={cn('text-[8px] font-mono uppercase tracking-wider', STATE_COLOR[entry.state] ?? 'text-ix-text-faint')}>
        {entry.state.replace('_', ' ')}
      </span>

      {/* Time */}
      <span className="text-[8px] font-mono text-ix-text-faint">{relTime}</span>
    </div>
  )
}

function getRelTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}
