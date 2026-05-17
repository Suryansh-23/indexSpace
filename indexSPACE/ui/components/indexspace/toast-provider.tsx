'use client'

import { createContext, useContext, useCallback, useState } from 'react'
import { cn } from '@/lib/utils'

export type ToastColor = 'green' | 'blue' | 'orange' | 'yellow' | 'red' | 'muted'

interface ToastEntry {
  id: string
  message: string
  sub?: string
  color: ToastColor
  txHash?: string
  visible: boolean
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastEntry, 'id' | 'visible'>) => void
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const COLOR_STYLES: Record<ToastColor, { border: string; text: string }> = {
  green:  { border: 'border-l-ix-green',  text: 'text-ix-green' },
  blue:   { border: 'border-l-ix-blue',   text: 'text-ix-blue' },
  orange: { border: 'border-l-ix-orange', text: 'text-ix-orange' },
  yellow: { border: 'border-l-ix-yellow', text: 'text-ix-yellow' },
  red:    { border: 'border-l-ix-red',    text: 'text-ix-red' },
  muted:  { border: 'border-l-ix-border', text: 'text-ix-text-faint' },
}

const EXPLORER_TX = 'https://sepolia.basescan.org/tx/'

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: string) => void }) {
  const c = COLOR_STYLES[toast.color]
  const canClick = !!toast.txHash

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => toast.txHash && window.open(`${EXPLORER_TX}${toast.txHash}`, '_blank', 'noopener,noreferrer')}
      className={cn(
        'flex items-start gap-3 pl-3 pr-2.5 py-2.5',
        'bg-ix-panel border border-ix-border border-l-2',
        'min-w-[240px] max-w-[300px]',
        'transition-all duration-200',
        toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        c.border,
        canClick ? 'cursor-pointer hover:bg-ix-panel-warm' : 'cursor-default',
      )}
    >
      <div className="flex-1 min-w-0">
        <span className={cn('text-[9px] font-mono tracking-[0.14em] uppercase leading-none block', c.text)}>
          {toast.message}
        </span>
        {toast.sub && (
          <span className="text-[8px] font-mono text-ix-text-faint mt-1 block truncate">
            {toast.sub}
          </span>
        )}
        {canClick && (
          <span className="text-[7px] font-mono text-ix-text-faint mt-0.5 block tracking-wider">
            VIEW IN EXPLORER ↗
          </span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.id) }}
        className="text-ix-text-faint hover:text-ix-text-muted text-[11px] leading-none shrink-0 mt-px"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const addToast = useCallback((toast: Omit<ToastEntry, 'id' | 'visible'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(prev => [...prev, { ...toast, id, visible: false }])
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: true } : t))
      })
    })
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t))
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 250)
    }, 5000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 250)
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-10 left-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
