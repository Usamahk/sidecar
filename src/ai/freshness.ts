import type { Insight, ResearchItem, VaultDocKind } from '@/types'
import { putVaultDoc, getVaultDoc } from '@/db/vaultDocs'

/**
 * Freshness engine for the compounding wiki. A built concept records the
 * evidence it was synthesized from as a hash; staleness is *derived* by
 * comparing the current evidence hash to the stored one (no mutation hooks).
 * The evidence is the concept's source set — a theme's items, or an insight's
 * items + theme membership — fingerprinted by id + updatedAt so adds, edits,
 * and removals all change the hash.
 */

function hashString(s: string): string {
  // djb2 — small, stable, good enough for change detection.
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function fingerprint(items: ResearchItem[]): string {
  return items
    .filter((it) => it.id != null)
    .map((it) => `${it.id}:${it.updatedAt}`)
    .sort()
    .join('|')
}

export function itemsForTheme(themeId: number, items: ResearchItem[]): ResearchItem[] {
  return items.filter((it) => (it.themeIds ?? []).includes(themeId))
}

export function evidenceHashForTheme(themeId: number, items: ResearchItem[]): string {
  return hashString(`theme:${themeId}:${fingerprint(itemsForTheme(themeId, items))}`)
}

export function itemsForInsight(insight: Insight, items: ResearchItem[]): ResearchItem[] {
  const themeIdSet = new Set(insight.themeIds)
  const namedIds = new Set(insight.itemIds)
  return items.filter(
    (it) => it.id != null && (namedIds.has(it.id) || (it.themeIds ?? []).some((id) => themeIdSet.has(id)))
  )
}

export function evidenceHashForInsight(insight: Insight, items: ResearchItem[]): string {
  const themePart = [...insight.themeIds].sort((a, b) => a - b).join(',')
  return hashString(`insight:${insight.id}:themes=${themePart}:${fingerprint(itemsForInsight(insight, items))}`)
}

/** Record that a concept was built from the given evidence hash. */
export async function recordBuilt(
  conceptId: string,
  kind: VaultDocKind,
  refId: number,
  evidenceHash: string
): Promise<void> {
  await putVaultDoc({ conceptId, kind, refId, evidenceHash, builtAt: Date.now() })
}

/** Stale if it has never been built, or its current evidence differs from build time. */
export async function isStale(conceptId: string, currentHash: string): Promise<boolean> {
  const doc = await getVaultDoc(conceptId)
  if (!doc) return true
  return doc.evidenceHash !== currentHash
}

/** Synchronous staleness check against an already-loaded VaultDoc map. */
export function isStaleSync(currentHash: string, storedHash: string | undefined): boolean {
  return storedHash == null || storedHash !== currentHash
}
