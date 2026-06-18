import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { saveAs } from 'file-saver'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { db } from '@/db/schema'
import { buildDossier, BuildError } from '@/ai/builder'
import { generateOutput, outputConceptId, OUTPUT_TEMPLATES, OutputError } from '@/ai/output'
import { readConcept, slugify } from '@/vault'
import {
  getBackupStatus,
  connectBackupFolder,
  subscribeBackupStatus,
  type BackupStatus,
} from '@/db/backup'
import { formatUsd } from '@/ai/models'
import { evidenceHashForInsight } from '@/ai/freshness'
import { ThemeWikiPanel } from '@/sidepanel/components/ThemeWikiPanel'
import type { Insight, ResearchItem, Theme, VaultDoc } from '@/types'

const STATUS_LABEL: Record<string, string> = {
  resolving: 'Resolving sources',
  researching: 'Researching',
  synthesizing: 'Writing dossier',
  done: 'Done',
  error: 'Error',
}

interface LoadedDossier {
  conceptId: string
  title: string
  body: string
}

function download(filename: string, text: string) {
  saveAs(new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename)
}

type Mode = 'insights' | 'themes'

export function ResearchView() {
  const insights = useLiveQuery(() => db.insights.orderBy('generatedAt').reverse().toArray(), [])
  const themes = useLiveQuery(() => db.themes.toArray(), [])
  const allItems = useLiveQuery(() => db.items.toArray(), [])
  const vaultDocs = useLiveQuery(() => db.vaultDocs.toArray(), [])
  const [mode, setMode] = useState<Mode>('insights')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dossier, setDossier] = useState<LoadedDossier | null>(null)
  const [templateId, setTemplateId] = useState(OUTPUT_TEMPLATES[0]?.id ?? 'newsletter')
  const [output, setOutput] = useState<{ body: string; manual: boolean } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [outputError, setOutputError] = useState<string | null>(null)
  const [vault, setVault] = useState<BackupStatus | null>(null)

  const build = useLiveQuery(
    () => (selectedId == null ? undefined : db.builds.where('insightId').equals(selectedId).last()),
    [selectedId]
  )

  const themeById = new Map<number, Theme>((themes ?? []).map((t: Theme) => [t.id!, t]))
  const selected = (insights ?? []).find((i: Insight) => i.id === selectedId) ?? null

  const dossierStale = (() => {
    if (!selected || build?.status !== 'done' || !allItems) return false
    const stored = (vaultDocs ?? []).find((d: VaultDoc) => d.kind === 'insight' && d.refId === selected.id)?.evidenceHash
    return stored != null && stored !== evidenceHashForInsight(selected, allItems as ResearchItem[])
  })()

  // Track vault (backup folder) connection so the user can connect from here.
  useEffect(() => {
    getBackupStatus().then(setVault)
    return subscribeBackupStatus(() => { getBackupStatus().then(setVault) })
  }, [])

  // Load the dossier from the vault whenever a finished build points at one.
  useEffect(() => {
    let cancelled = false
    const conceptId = build?.status === 'done' ? build.dossierConceptId : undefined
    if (!conceptId) {
      setDossier(null)
      return
    }
    readConcept(conceptId).then((c) => {
      if (!cancelled) {
        setDossier(c ? { conceptId, title: c.title ?? conceptId.split('/').pop()!, body: c.body } : null)
      }
    })
    return () => { cancelled = true }
  }, [build?.status, build?.dossierConceptId])

  // Reload any previously-generated output for (dossier, template) from the
  // vault so it persists across navigation. Manual handoffs aren't saved.
  useEffect(() => {
    let cancelled = false
    if (!dossier) {
      setOutput(null)
      return
    }
    readConcept(outputConceptId(dossier.title, templateId)).then((c) => {
      if (!cancelled) setOutput(c ? { body: c.body, manual: false } : null)
    })
    return () => { cancelled = true }
  }, [dossier?.conceptId, templateId])

  useEffect(() => {
    setError(null)
    setOutputError(null)
  }, [selectedId])

  async function handleConnect() {
    await connectBackupFolder()
    getBackupStatus().then(setVault)
  }

  async function handleGenerate() {
    if (!dossier || generating) return
    setOutputError(null)
    setGenerating(true)
    try {
      const res = await generateOutput(dossier.conceptId, templateId)
      setOutput(res.manual ? { body: res.dossier, manual: true } : { body: res.body, manual: false })
    } catch (err) {
      const msg = err instanceof OutputError ? err.message : err instanceof Error ? err.message : 'Generation failed'
      setOutputError(msg)
    } finally {
      setGenerating(false)
    }
  }

  async function handleBuild() {
    if (selectedId == null || isBuilding) return
    setError(null)
    setDossier(null)
    setOutput(null)
    setOutputError(null)
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

  const running = build && (build.status === 'resolving' || build.status === 'researching' || build.status === 'synthesizing')
  const templateLabel = OUTPUT_TEMPLATES.find((t) => t.id === templateId)?.label ?? 'Output'

  return (
    <div className="flex flex-col h-full">
      {/* Vault status */}
      <div className="px-3 py-1.5 border-b border-line bg-surface-1 flex items-center gap-2 text-[11px]">
        <span className="text-ink-3">Vault</span>
        {vault?.connected ? (
          <span className="text-ink-2 truncate" title={vault.folderName ?? ''}>{vault.folderName}</span>
        ) : (
          <>
            <span className="text-ink-3">not connected</span>
            <button onClick={handleConnect} className="ml-auto text-accent hover:opacity-80">Connect folder</button>
          </>
        )}
      </div>

      {/* Mode toggle */}
      <div className="px-3 py-1.5 border-b border-line bg-surface-1 flex items-center gap-1">
        {(['insights', 'themes'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize
              ${mode === m ? 'bg-accent/15 border-accent text-accent' : 'border-line text-ink-3 hover:text-ink-2'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'themes' ? (
        <ThemeWikiPanel />
      ) : insights.length === 0 ? (
        <div className="p-6 text-xs text-ink-3 leading-relaxed">
          <p className="text-ink-2 font-medium mb-1">No insights yet.</p>
          <p>Surface some insights from the Themes tab, then come back to build research from one.</p>
        </div>
      ) : (
        <>
          {/* Insight picker */}
          <div className="border-b border-line bg-surface-1 max-h-[30%] overflow-y-auto">
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
                      return <span key={id} className="w-2 h-2 rounded-full" style={{ background: t.color }} title={t.name} />
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

                {dossierStale && !running && (
                  <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-600 dark:text-amber-400">
                    Sources changed since this dossier was built — Rebuild to refresh.
                  </div>
                )}

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
                      <span className="block mt-1 text-ink-3">Connect a vault folder above (or in Settings → Backup).</span>
                    )}
                  </div>
                )}

                {dossier && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-[10px] text-ink-3">
                      <span>Dossier</span>
                      {build && build.costUsd > 0 && <span className="tabular-nums">· {formatUsd(build.costUsd)}</span>}
                      <button onClick={() => navigator.clipboard.writeText(dossier.body)} className="ml-auto text-accent hover:opacity-80">Copy</button>
                      <button onClick={() => download(`${slugify(dossier.title)}.md`, dossier.body)} className="text-accent hover:opacity-80">Export .md</button>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                      prose-p:my-1 prose-headings:text-ink prose-a:text-accent prose-code:text-accent
                      prose-blockquote:border-accent prose-blockquote:text-ink-2">
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
                      >{dossier.body}</ReactMarkdown>
                    </div>

                    {/* Output generation */}
                    <div className="mt-4 pt-3 border-t border-line space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={templateId}
                          onChange={(e) => setTemplateId(e.target.value)}
                          className="text-xs bg-surface-2 border border-line rounded-lg px-2 py-1.5 text-ink-2 outline-none"
                        >
                          {OUTPUT_TEMPLATES.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="px-3 py-1.5 text-xs rounded-lg border border-line text-ink-2 hover:border-line-strong disabled:opacity-50"
                        >
                          {generating ? 'Generating…' : output && !output.manual ? `Regenerate ${templateLabel}` : `Generate ${templateLabel}`}
                        </button>
                      </div>

                      {outputError && (
                        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{outputError}</div>
                      )}

                      {output && (
                        <div>
                          <div className="flex items-center gap-2 mb-2 text-[10px] text-ink-3">
                            <span>{output.manual ? 'Manual mode — finish in your tool of choice' : templateLabel}</span>
                            <button onClick={() => navigator.clipboard.writeText(output.body)} className="ml-auto text-accent hover:opacity-80">
                              {output.manual ? 'Copy dossier' : 'Copy'}
                            </button>
                            {!output.manual && (
                              <button
                                onClick={() => download(`${slugify(dossier.title)}-${templateId}.md`, output.body)}
                                className="text-accent hover:opacity-80"
                              >
                                Export .md
                              </button>
                            )}
                          </div>
                          {!output.manual && (
                            <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                              prose-p:my-1 prose-headings:text-ink prose-a:text-accent">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output.body}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
