import { db } from './schema'
import type { SourceCacheEntry } from '@/types'

// Sources are considered fresh for this long; older entries are re-resolved on
// the next build so link-rot / paywall changes eventually get another attempt.
const FRESH_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export async function getSourceCache(itemId: number): Promise<SourceCacheEntry | undefined> {
  return db.sourceCache.get(itemId)
}

export async function putSourceCache(entry: SourceCacheEntry): Promise<void> {
  await db.sourceCache.put(entry)
}

/** A cached source is reusable if it exists, isn't stale, and got real text. */
export function isFresh(entry: SourceCacheEntry | undefined): boolean {
  if (!entry) return false
  if (entry.needsWeb) return false // snippet-only / failed fetch — worth retrying
  return Date.now() - entry.resolvedAt < FRESH_MS
}

export async function deleteSourceCache(itemId: number): Promise<void> {
  await db.sourceCache.delete(itemId)
}
