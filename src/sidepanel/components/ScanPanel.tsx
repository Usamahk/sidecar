import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { scanCorpus, ScanError } from '@/ai/scan'
import { replaceQueue } from '@/db/suggestions'
import type { ResearchItem } from '@/types'

type Status = 'idle' | 'confirming' | 'scanning' | 'error'
type Scope = 'untagged' | 'all'

export function ScanPanel() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('untagged')
  const popoverRef = useRef<HTMLDivElement>(null)

  const itemCount = useLiveQuery(() => db.items.count(), [])
  const themeCount = useLiveQuery(() => db.themes.count(), [])
  const apiKeyRow = useLiveQuery(() => db.settings.get('anthropicApiKey'), [])
  const lastScanRow = useLiveQuery(() => db.settings.get('lastScanAt'), [])

  const untaggedCount = useLiveQuery(
    () => db.items.filter((i: ResearchItem) => (i.themeIds?.length ?? 0) === 0).count(),
    []
  )

  const lastScanAt = lastScanRow?.value ? Number(lastScanRow.value) : null

  // If no items are untagged, prefer scanning all so the chip strip isn't a dead end.
  useEffect(() => {
    if (untaggedCount === 0 && scope === 'untagged' && (itemCount ?? 0) > 0) {
      setScope('all')
    }
  }, [untaggedCount, itemCount, scope])

  const effectiveCount = scope === 'untagged' ? (untaggedCount ?? 0) : (itemCount ?? 0)
  const hasKey = !!apiKeyRow?.value?.trim()
  const hasItems = effectiveCount > 0
  const canScan = hasKey && hasItems && status !== 'scanning'

  useEffect(() => {
    if (status !== 'confirming') return
    function handle(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setStatus('idle')
      }
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setStatus('idle') }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onEsc)
    }
  }, [status])

  async function runScan() {
    setStatus('scanning')
    setError(null)
    try {
      const themes = await db.themes.toArray()
      const items = scope === 'untagged'
        ? await db.items
            .filter((i: ResearchItem) => (i.themeIds?.length ?? 0) === 0)
            .toArray()
        : await db.items.toArray()
      const result = await scanCorpus(items, themes)
      await replaceQueue(result)
      setStatus('idle')
    } catch (err) {
      const msg = err instanceof ScanError ? err.message
        : err instanceof Error ? err.message
        : 'Scan failed'
      setError(msg)
      setStatus('error')
    }
  }

  let label: string
  if (!hasKey) label = 'Set API key in Settings to scan'
  else if ((itemCount ?? 0) === 0) label = 'Add items first'
  else if (status === 'scanning') label = 'Scanning…'
  else if (!hasItems) label = 'Everything is tagged'
  else if (scope === 'untagged') label = `Scan · ${effectiveCount} untagged item${effectiveCount !== 1 ? 's' : ''}`
  else label = `Scan all · ${effectiveCount} item${effectiveCount !== 1 ? 's' : ''}`

  const approxTokens = Math.ceil((effectiveCount * 350 + (themeCount ?? 0) * 80 + 1500) / 3.5)
  const canPickUntagged = (untaggedCount ?? 0) > 0

  return (
    <div className="px-3 py-2 border-b border-line relative">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setStatus((s) => s === 'confirming' ? 'idle' : 'confirming')}
          disabled={!canScan}
          className="flex-1 text-left text-sm px-3 py-1.5 rounded-lg border border-line bg-surface-1
            hover:border-line-strong disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors flex items-center gap-2"
        >
          <span className={status === 'scanning' ? 'animate-spin' : ''}>
            {status === 'scanning' ? '⟳' : '⚡'}
          </span>
          <span className="text-ink-2">{label}</span>
        </button>
        {lastScanAt != null && status !== 'scanning' && (
          <span className="text-[10px] text-ink-3 flex-shrink-0">
            {formatAgo(lastScanAt)}
          </span>
        )}
      </div>

      {hasKey && (itemCount ?? 0) > 0 && status !== 'scanning' && (
        <div className="flex items-center gap-1 mt-1.5 ml-1">
          <ScopeChip
            label={`Untagged${canPickUntagged ? ` (${untaggedCount})` : ''}`}
            active={scope === 'untagged'}
            disabled={!canPickUntagged}
            title={canPickUntagged ? 'Only items without any theme tags' : 'No untagged items'}
            onClick={() => setScope('untagged')}
          />
          <ScopeChip
            label={`All (${itemCount})`}
            active={scope === 'all'}
            onClick={() => setScope('all')}
          />
        </div>
      )}

      {status === 'confirming' && canScan && (
        <div
          ref={popoverRef}
          className="absolute top-full left-3 right-3 mt-1 z-30 bg-surface-1 border border-line-strong rounded-lg shadow-lg p-3"
        >
          <p className="text-sm text-ink mb-1">
            Send {effectiveCount} {scope === 'untagged' ? 'untagged ' : ''}item{effectiveCount !== 1 ? 's' : ''} to Claude?
          </p>
          <p className="text-xs text-ink-3 mb-3">
            Estimated ~{approxTokens.toLocaleString()} input tokens
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStatus('idle')}
              className="text-xs px-3 py-1 rounded border border-line text-ink-2 hover:border-line-strong transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={runScan}
              className="text-xs px-3 py-1 rounded bg-accent text-white hover:opacity-90 transition-opacity"
            >
              Scan
            </button>
          </div>
        </div>
      )}

      {status === 'error' && error && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {error}
          <button
            onClick={() => { setError(null); setStatus('idle') }}
            className="ml-2 text-red-400 hover:text-red-300 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

interface ChipProps {
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}

function ScopeChip({ label, active, disabled, title, onClick }: ChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors
        ${active
          ? 'bg-accent/15 border-accent text-accent'
          : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'
        }
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-ink-3 disabled:hover:border-line`}
    >
      {label}
    </button>
  )
}

function formatAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
