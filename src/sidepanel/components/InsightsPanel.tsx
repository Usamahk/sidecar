import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { surfaceInsights, InsightError, estimateInsightTokens } from '@/ai/surfaceInsights'
import { replaceInsightQueue } from '@/db/suggestions'
import { useHasApiKey } from '@/hooks/useApiKey'

type Status = 'idle' | 'confirming' | 'running' | 'error' | 'done'

export function InsightsPanel() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastCount, setLastCount] = useState<number | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const itemCount = useLiveQuery(() => db.items.count(), [])
  const themeCount = useLiveQuery(() => db.themes.count(), [])
  const hasKey = useHasApiKey()
  const lastRow = useLiveQuery(() => db.settings.get('lastInsightAt'), [])
  const lastAt = lastRow?.value ? Number(lastRow.value) : null

  const tokenEstimate = useLiveQuery(async () => {
    if ((themeCount ?? 0) === 0 || (itemCount ?? 0) === 0) return 0
    const [items, themes] = await Promise.all([db.items.toArray(), db.themes.toArray()])
    return estimateInsightTokens(themes, items)
  }, [themeCount, itemCount]) ?? 0

  const hasItems = (itemCount ?? 0) > 0
  const hasThemes = (themeCount ?? 0) > 0
  const canRun = hasKey && hasItems && hasThemes && status !== 'running'

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

  // Hide "done" feedback after a few seconds.
  useEffect(() => {
    if (status !== 'done') return
    const t = setTimeout(() => setStatus('idle'), 6000)
    return () => clearTimeout(t)
  }, [status])

  async function run() {
    setStatus('running')
    setError(null)
    try {
      const [items, themes] = await Promise.all([
        db.items.toArray(),
        db.themes.toArray(),
      ])
      const result = await surfaceInsights(items, themes)
      await replaceInsightQueue(result)
      setLastCount(result.proposals.length)
      setStatus('done')
    } catch (err) {
      const msg = err instanceof InsightError ? err.message
        : err instanceof Error ? err.message
        : 'Surface failed'
      setError(msg)
      setStatus('error')
    }
  }

  let label: string
  if (!hasKey) label = 'Set API key in Settings to surface insights'
  else if (!hasItems) label = 'Capture items first'
  else if (!hasThemes) label = 'Tag items with themes first'
  else if (status === 'running') label = 'Surfacing insights…'
  else label = `Surface insights · ${themeCount} themes`

  return (
    <div className="px-3 py-2 border-b border-line relative">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setStatus((s) => s === 'confirming' ? 'idle' : 'confirming')}
          disabled={!canRun}
          className="flex-1 text-left text-sm px-3 py-1.5 rounded-lg border border-line bg-surface-1
            hover:border-line-strong disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors flex items-center gap-2"
        >
          <span className={status === 'running' ? 'animate-spin' : ''}>
            {status === 'running' ? '⟳' : '✦'}
          </span>
          <span className="text-ink-2">{label}</span>
        </button>
        {lastAt != null && status !== 'running' && (
          <span className="text-[10px] text-ink-3 flex-shrink-0">{formatAgo(lastAt)}</span>
        )}
      </div>

      {status === 'confirming' && canRun && (
        <div
          ref={popoverRef}
          className="absolute top-full left-3 right-3 mt-1 z-30 bg-surface-1 border border-line-strong rounded-lg shadow-lg p-3"
        >
          <p className="text-sm text-ink mb-1">
            Look across {themeCount} themes and {itemCount} items for emerging patterns?
          </p>
          <p className="text-xs text-ink-3 mb-3">
            Estimated ~{tokenEstimate.toLocaleString()} input tokens
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStatus('idle')}
              className="text-xs px-3 py-1 rounded border border-line text-ink-2 hover:border-line-strong transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={run}
              className="text-xs px-3 py-1 rounded bg-accent text-on-accent hover:opacity-90 transition-opacity"
            >
              Surface
            </button>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-xs text-accent">
          {lastCount === 0
            ? 'No new insights surfaced — your corpus may not have strong cross-theme patterns yet, or all good candidates were previously rejected.'
            : `Surfaced ${lastCount} insight${lastCount === 1 ? '' : 's'} — review below.`}
          <button
            onClick={() => setStatus('idle')}
            className="ml-2 text-accent hover:opacity-80 underline"
          >
            Dismiss
          </button>
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
