import { db } from '@/db/schema'
import type { Insight, ResearchItem, Theme, VaultDoc, SourceCacheEntry } from '@/types'
import {
  evidenceHashForTheme,
  evidenceHashForInsight,
  itemsForTheme,
} from '@/ai/freshness'
import { conceptIdFor, deleteConcept } from '@/vault'
import { deleteSourceCache } from '@/db/sourceCache'
import { appendLog } from '@/vault'

/**
 * Structural wiki health check (the doc's Lint, no-LLM tier). Surfaces what the
 * compounding wiki needs done — stale/missing theme pages, stale dossiers, and
 * orphaned source files — all derivable from the DB + freshness hashes. Each
 * finding has a one-click fix. Contradiction-detection (LLM) is a later tier.
 */

export interface LintReport {
  missingThemes: Array<{ themeId: number; name: string }>
  staleThemes: Array<{ themeId: number; name: string; conceptId: string }>
  staleDossiers: Array<{ insightId: number; headline: string; conceptId: string }>
  orphanSources: Array<{ itemId: number; conceptId: string }>
  ranAt: number
}

export function isHealthy(r: LintReport): boolean {
  return (
    r.missingThemes.length === 0 &&
    r.staleThemes.length === 0 &&
    r.staleDossiers.length === 0 &&
    r.orphanSources.length === 0
  )
}

export async function runLint(): Promise<LintReport> {
  const [themes, items, insights, vaultDocs, sourceEntries] = await Promise.all([
    db.themes.toArray() as Promise<Theme[]>,
    db.items.toArray() as Promise<ResearchItem[]>,
    db.insights.toArray() as Promise<Insight[]>,
    db.vaultDocs.toArray() as Promise<VaultDoc[]>,
    db.sourceCache.toArray() as Promise<SourceCacheEntry[]>,
  ])

  const themeHash = new Map<number, string>()
  const insightHash = new Map<number, string>()
  for (const d of vaultDocs) {
    if (d.kind === 'theme') themeHash.set(d.refId, d.evidenceHash)
    else if (d.kind === 'insight') insightHash.set(d.refId, d.evidenceHash)
  }

  const missingThemes: LintReport['missingThemes'] = []
  const staleThemes: LintReport['staleThemes'] = []
  for (const t of themes) {
    if (t.id == null) continue
    if (itemsForTheme(t.id, items).length === 0) continue
    const stored = themeHash.get(t.id)
    if (stored == null) {
      missingThemes.push({ themeId: t.id, name: t.name })
    } else if (stored !== evidenceHashForTheme(t.id, items)) {
      staleThemes.push({ themeId: t.id, name: t.name, conceptId: conceptIdFor('themes', t.name, t.id) })
    }
  }

  const staleDossiers: LintReport['staleDossiers'] = []
  for (const ins of insights) {
    if (ins.id == null) continue
    const stored = insightHash.get(ins.id)
    if (stored != null && stored !== evidenceHashForInsight(ins, items)) {
      staleDossiers.push({ insightId: ins.id, headline: ins.headline, conceptId: conceptIdFor('insights', ins.headline, ins.id) })
    }
  }

  const liveItemIds = new Set(items.map((i) => i.id))
  const orphanSources = sourceEntries
    .filter((e) => !liveItemIds.has(e.itemId))
    .map((e) => ({ itemId: e.itemId, conceptId: e.conceptId }))

  return { missingThemes, staleThemes, staleDossiers, orphanSources, ranAt: Date.now() }
}

/** Remove a source concept whose item was deleted (file + cache entry). */
export async function removeOrphanSource(itemId: number, conceptId: string): Promise<void> {
  await deleteConcept(conceptId)
  await deleteSourceCache(itemId)
  await appendLog('Deprecation', `Removed orphaned source /${conceptId}.md (item deleted)`)
}
