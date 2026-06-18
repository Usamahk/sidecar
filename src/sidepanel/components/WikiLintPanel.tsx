import { useState } from 'react'
import { runLint, removeOrphanSource, isHealthy, type LintReport } from '@/ai/wiki/lint'
import { buildThemePage } from '@/ai/wiki/themePage'
import { buildDossier } from '@/ai/builder'

export function WikiLintPanel() {
  const [report, setReport] = useState<LintReport | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    setError(null)
    setRunning(true)
    try {
      setReport(await runLint())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed')
    } finally {
      setRunning(false)
    }
  }

  async function fix(key: string, fn: () => Promise<unknown>) {
    setError(null)
    setBusy(key)
    try {
      await fn()
      setReport(await runLint())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix failed')
    } finally {
      setBusy(null)
    }
  }

  const row = (key: string, label: string, action: string, fn: () => Promise<unknown>) => (
    <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-line">
      <span className="text-xs text-ink-2 flex-1 truncate">{label}</span>
      <button
        onClick={() => fix(key, fn)}
        disabled={busy !== null}
        className="text-[11px] px-2 py-1 rounded border border-line text-accent hover:border-line-strong disabled:opacity-50"
      >
        {busy === key ? '…' : action}
      </button>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-3">Structural health check of the wiki bundle.</p>
        <button
          onClick={check}
          disabled={running}
          className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg bg-accent text-on-accent disabled:opacity-50"
        >
          {running ? 'Checking…' : 'Run check'}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
      )}

      {report && isHealthy(report) && (
        <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-600 dark:text-green-400">
          Wiki is healthy — nothing to fix.
        </div>
      )}

      {report && report.missingThemes.length > 0 && (
        <Section title={`Missing theme pages (${report.missingThemes.length})`}>
          {report.missingThemes.map((m) =>
            row(`mt-${m.themeId}`, m.name, 'Build', () => buildThemePage(m.themeId))
          )}
        </Section>
      )}

      {report && report.staleThemes.length > 0 && (
        <Section title={`Stale theme pages (${report.staleThemes.length})`}>
          {report.staleThemes.map((s) =>
            row(`st-${s.themeId}`, s.name, 'Refresh', () => buildThemePage(s.themeId))
          )}
        </Section>
      )}

      {report && report.staleDossiers.length > 0 && (
        <Section title={`Stale dossiers (${report.staleDossiers.length})`}>
          {report.staleDossiers.map((s) =>
            row(`sd-${s.insightId}`, s.headline, 'Rebuild', () => buildDossier(s.insightId))
          )}
        </Section>
      )}

      {report && report.orphanSources.length > 0 && (
        <Section title={`Orphaned sources (${report.orphanSources.length})`}>
          {report.orphanSources.map((o) =>
            row(`os-${o.itemId}`, o.conceptId, 'Remove', () => removeOrphanSource(o.itemId, o.conceptId))
          )}
        </Section>
      )}

      {!report && !running && (
        <p className="text-xs text-ink-3">Run a check to find stale or missing pages and orphaned sources.</p>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-ink-3 font-medium">{title}</p>
      {children}
    </div>
  )
}
