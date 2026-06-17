import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { db } from '@/db/schema'
import { buildDossier, BuildError } from '@/ai/builder'
import { readConcept } from '@/vault'
import { formatUsd } from '@/ai/models'
import type { Insight, Theme } from '@/types'

const STATUS_LABEL: Record<string, string> = {
  resolving: 'Resolving sources',
  researching: 'Researching',
  synthesizing: 'Writing dossier',
  done: 'Done',
  error: 'Error',
}

export function ResearchView() {
  const insights = useLiveQuery(() => db.insights.orderBy('generatedAt').reverse().toArray(), [])
  const themes = useLiveQuery(() => db.themes.toArray(), [])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dossier, setDossier] = useState<string | null>(null)

  const build = useLiveQuery(
    () => (selectedId == null ? undefined : db.builds.where('insightId').equals(selectedId).last()),
    [selectedId]
  )

  const themeById = new Map<number, Theme>((themes ?? []).map((t: Theme) => [t.id!, t]))
  const selected = (insights ?? []).find((i: Insight) => i.id === selectedId) ?? null

  // Load the dossier markdown from the vault whenever a finished build points at one.
  useEffect(() => {
    let cancelled = false
    const conceptId = build?.status === 'done' ? build.dossierConceptId : undefined
    if (!conceptId) {
      setDossier(null)
      return
    }
    readConcept(conceptId).then((c) => {
      if (!cancelled) setDossier(c?.body ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [build?.status, build?.dossierConceptId])

  async function handleBuild() {
    if (selectedId == null || isBuilding) return
    setError(null)
    setDossier(null)
    setIsBuilding(true)
    try {
      await buildDossier(selectedId)
    } catch (err) {
      const msg = err instanceof BuildError ? err.message : err instanceof Error ? err.message : 'Build failed'
      setError(msg)
    } finally {
      setIsBuilding(false)
    }
  }

  if (!insights) return <div className="p-4 text-xs text-ink-3">Loading…</div>

  if (insights.length === 0) {
    return (
      <div className="p-6 text-xs text-ink-3 leading-relaxed">
        <p className="text-ink-2 font-medium mb-1">No insights yet.</p>
        <p>Surface some insights from the Themes tab, then come back to build research from one.</p>
      </div>
    )
  }

  const running = build && (build.status === 'resolving' || build.status === 'researching' || build.status === 'synthesizing')

  return (
    <div className="flex flex-col h-full">
      {/* Insight picker */}
      <div className="border-b border-line bg-surface-1 max-h-[34%] overflow-y-auto">
        {insights.map((ins: Insight) => {
          const active = ins.id === selectedId
          return (
            <button
              key={ins.id}
              onClick={() => setSelectedId(ins.id!)}
              className={`w-full text-left px-3 py-2 border-b border-line/60 transition-colors
                ${active ? 'bg-accent/10' : 'hover:bg-surface-2'}`}
            >
              <div className={`text-sm ${active ? 'text-accent font-medium' : 'text-ink'}`}>{ins.headline}</div>
              <div className="flex items-center gap-1 mt-1">
                {ins.themeIds.map((id) => {
                  const t = themeById.get(id)
                  if (!t) return null
                  return (
                    <span key={id} className="w-2 h-2 rounded-full" style={{ background: t.color }} title={t.name} />
                  )
                })}
                <span className="text-[10px] text-ink-3 ml-1">{ins.itemIds.length} items</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Build area */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-6 text-center text-xs text-ink-3">Select an insight to build a research dossier.</div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink font-medium truncate">{selected.headline}</p>
                {selected.rationale && <p className="text-[11px] text-ink-3 line-clamp-2">{selected.rationale}</p>}
              </div>
              <button
                onClick={handleBuild}
                disabled={isBuilding}
                className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg bg-accent text-on-accent disabled:opacity-50"
              >
                {isBuilding ? 'Building…' : dossier ? 'Rebuild' : 'Build research'}
              </button>
            </div>

            {running && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-line text-xs text-ink-2">
                <span className="animate-spin">⟳</span>
                <span>{build?.step || STATUS_LABEL[build!.status]}</span>
                {build && build.costUsd > 0 && <span className="ml-auto text-ink-3 tabular-nums">{formatUsd(build.costUsd)}</span>}
              </div>
            )}

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                {error}
                {/no vault|not connected/i.test(error) && (
                  <span className="block mt-1 text-ink-3">Connect a folder in Settings → Backup to store the vault.</span>
                )}
              </div>
            )}

            {dossier && (
              <div>
                {build && build.status === 'done' && (
                  <div className="flex items-center gap-2 mb-2 text-[10px] text-ink-3">
                    <span>Dossier</span>
                    {build.costUsd > 0 && <span className="tabular-nums">· {formatUsd(build.costUsd)}</span>}
                    <button
                      onClick={() => navigator.clipboard.writeText(dossier)}
                      className="ml-auto text-accent hover:opacity-80"
                    >
                      Copy markdown
                    </button>
                  </div>
                )}
                <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                  prose-p:my-1 prose-headings:text-ink prose-a:text-accent prose-code:text-accent
                  prose-blockquote:border-accent prose-blockquote:text-ink-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault()
                            if (href && /^https?:/.test(href)) chrome.tabs.create({ url: href })
                          }}
                          className="text-accent underline cursor-pointer hover:opacity-80"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >{dossier}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
