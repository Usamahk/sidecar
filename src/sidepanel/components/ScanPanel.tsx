import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { scanCorpus, ScanError } from '@/ai/scan'
import { replaceQueue } from '@/db/suggestions'

type Status = 'idle' | 'confirming' | 'scanning' | 'error'

export function ScanPanel() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const itemCount = useLiveQuery(() => db.items.count(), [])
  const themeCount = useLiveQuery(() => db.themes.count(), [])
  const apiKeyRow = useLiveQuery(() => db.settings.get('anthropicApiKey'), [])
  const lastScanRow = useLiveQuery(() => db.settings.get('lastScanAt'), [])

  const hasKey = !!apiKeyRow?.value?.trim()
  const hasItems = (itemCount ?? 0) > 0
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
      const [items, themes] = await Promise.all([
        db.items.toArray(),
        db.themes.toArray(),
      ])
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
  else if (!hasItems) label = 'Add items first'
  else if (status === 'scanning') label = 'Scanning…'
  else label = `Scan corpus · ${itemCount} item${itemCount !== 1 ? 's' : ''}`

  const approxTokens = Math.ceil(((itemCount ?? 0) * 350 + (themeCount ?? 0) * 80 + 1500) / 3.5)

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
        {lastScanRow?.value && status !== 'scanning' && (
          <span className="text-[10px] text-ink-3 flex-shrink-0">
            {formatAgo(Number(lastScanRow.value))}
          </span>
        )}
      </div>

      {status === 'confirming' && canScan && (
        <div
          ref={popoverRef}
          className="absolute top-full left-3 right-3 mt-1 z-30 bg-surface-1 border border-line-strong rounded-lg shadow-lg p-3"
        >
          <p className="text-sm text-ink mb-1">
            Send {itemCount} item{itemCount !== 1 ? 's' : ''} to Claude?
          </p>
          <p className="text-xs text-ink-3 mb-3">
            Estimated ~{approxTokens.toLocaleString()} input tokens · claude-sonnet-4-6
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

function formatAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
