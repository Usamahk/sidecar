import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { saveAs } from 'file-saver'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { db } from '@/db/schema'
import { buildThemePage, ThemePageError } from '@/ai/wiki/themePage'
import { evidenceHashForTheme, itemsForTheme } from '@/ai/freshness'
import { readConcept, conceptIdFor, slugify } from '@/vault'
import type { ResearchItem, Theme, VaultDoc } from '@/types'

type ThemeStatus = 'empty' | 'unbuilt' | 'fresh' | 'stale'

function download(filename: string, text: string) {
  saveAs(new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename)
}

export function ThemeWikiPanel() {
  const themes = useLiveQuery(() => db.themes.toArray(), [])
  const items = useLiveQuery(() => db.items.toArray(), [])
  const vaultDocs = useLiveQuery(() => db.vaultDocs.toArray(), [])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState<string | null>(null)

  const storedHashByTheme = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of (vaultDocs ?? []) as VaultDoc[]) {
      if (d.kind === 'theme') m.set(d.refId, d.evidenceHash)
    }
    return m
  }, [vaultDocs])

  function statusOf(theme: Theme): ThemeStatus {
    const its = itemsForTheme(theme.id!, (items ?? []) as ResearchItem[])
    if (its.length === 0) return 'empty'
    const stored = storedHashByTheme.get(theme.id!)
    if (stored == null) return 'unbuilt'
    return stored === evidenceHashForTheme(theme.id!, (items ?? []) as ResearchItem[]) ? 'fresh' : 'stale'
  }

  const selected = (themes ?? []).find((t: Theme) => t.id === selectedId) ?? null
  const staleThemes = (themes ?? []).filter((t: Theme) => statusOf(t) === 'stale')

  // Load the selected theme's page from the vault.
  useEffect(() => {
    let cancelled = false
    if (!selected) { setPage(null); return }
    readConcept(conceptIdFor('themes', selected.name, selected.id!)).then((c) => {
      if (!cancelled) setPage(c?.body ?? null)
    })
    return () => { cancelled = true }
  }, [selectedId, vaultDocs])

  async function build(themeId: number) {
    setError(null)
    setBusyId(themeId)
    try {
      await buildThemePage(themeId)
    } catch (err) {
      setError(err instanceof ThemePageError ? err.message : err instanceof Error ? err.message : 'Build failed')
    } finally {
      setBusyId(null)
    }
  }

  async function refreshAllStale() {
    if (batchRunning) return
    setError(null)
    setBatchRunning(true)
    try {
      for (const t of staleThemes) {
        setBusyId(t.id!)
        await buildThemePage(t.id!)
      }
    } catch (err) {
      setError(err instanceof ThemePageError ? err.message : err instanceof Error ? err.message : 'Batch refresh failed')
    } finally {
      setBusyId(null)
      setBatchRunning(false)
    }
  }

  if (!themes) return <div className="p-4 text-xs text-ink-3">Loading…</div>
  if (themes.length === 0) {
    return <div className="p-6 text-xs text-ink-3">No themes yet. Create and tag themes first, then build their wiki pages here.</div>
  }

  const badge: Record<ThemeStatus, { dot: string; label: string }> = {
    empty: { dot: 'bg-ink-3/30', label: 'no items' },
    unbuilt: { dot: 'bg-ink-3', label: 'not built' },
    fresh: { dot: 'bg-green-500', label: 'fresh' },
    stale: { dot: 'bg-amber-500', label: 'stale' },
  }

  return (
    <div className="flex flex-col h-full">
      {staleThemes.length > 0 && (
        <div className="px-3 py-1.5 border-b border-line bg-surface-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-3">{staleThemes.length} page{staleThemes.length === 1 ? '' : 's'} stale</span>
          <button
            onClick={refreshAllStale}
            disabled={batchRunning}
            className="text-[11px] px-2 py-1 rounded-lg border border-line text-ink-2 hover:border-line-strong disabled:opacity-50"
          >
            {batchRunning ? 'Refreshing…' : 'Refresh all stale'}
          </button>
        </div>
      )}

      <div className="border-b border-line bg-surface-1 max-h-[30%] overflow-y-auto">
        {themes.map((t: Theme) => {
          const st = statusOf(t)
          const active = t.id === selectedId
          const count = itemsForTheme(t.id!, (items ?? []) as ResearchItem[]).length
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id!)}
              className={`w-full text-left px-3 py-2 border-b border-line/60 flex items-center gap-2 transition-colors
                ${active ? 'bg-accent/10' : 'hover:bg-surface-2'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: t.color }} />
              <span className={`text-sm flex-1 truncate ${active ? 'text-accent font-medium' : 'text-ink'}`}>{t.name}</span>
              <span className="text-[10px] text-ink-3">{count}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${badge[st].dot}`} title={badge[st].label} />
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-6 text-center text-xs text-ink-3">Select a theme to build or read its wiki page.</div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink font-medium truncate">{selected.name}</p>
                <p className="text-[11px] text-ink-3">{badge[statusOf(selected)].label}</p>
              </div>
              <button
                onClick={() => build(selected.id!)}
                disabled={busyId === selected.id || statusOf(selected) === 'empty'}
                className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg bg-accent text-on-accent disabled:opacity-50"
              >
                {busyId === selected.id ? 'Building…' : page ? 'Refresh page' : 'Build page'}
              </button>
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                {error}
                {/no vault|not connected/i.test(error) && (
                  <span className="block mt-1 text-ink-3">Connect a vault folder above (or in Settings → Backup).</span>
                )}
              </div>
            )}

            {page && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-[10px] text-ink-3">
                  <span>Theme page</span>
                  <button onClick={() => navigator.clipboard.writeText(page)} className="ml-auto text-accent hover:opacity-80">Copy</button>
                  <button onClick={() => download(`${slugify(selected.name)}.md`, page)} className="text-accent hover:opacity-80">Export .md</button>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                  prose-p:my-1 prose-headings:text-ink prose-a:text-accent prose-code:text-accent">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => { e.preventDefault(); if (href && /^https?:/.test(href)) chrome.tabs.create({ url: href }) }}
                          className="text-accent underline cursor-pointer hover:opacity-80"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >{page}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
