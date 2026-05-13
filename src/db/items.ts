import { db } from './schema'
import type { ResearchItem, SourceType } from '@/types'
import { deleteAttachmentsForItem } from './attachments'

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function detectSourceType(url: string): SourceType {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    if (hostname === 'mail.google.com') return 'newsletter'
    if (hostname === 'twitter.com' || hostname === 'x.com') return 'twitter'
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) return 'reddit'
  } catch {}
  return 'website'
}

export async function addItem(
  partial: Pick<ResearchItem, 'rawContent' | 'url' | 'pageTitle' | 'date'> & { sourceSender?: string }
): Promise<number> {
  const now = Date.now()
  return db.items.add({
    content: partial.rawContent,
    rawContent: partial.rawContent,
    url: partial.url,
    domain: domainFromUrl(partial.url),
    pageTitle: partial.pageTitle,
    date: partial.date,
    notes: '',
    sourceType: detectSourceType(partial.url),
    sourceSender: partial.sourceSender ?? '',
    themeIds: [],
    conceptIds: [],
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateItem(id: number, changes: Partial<ResearchItem>): Promise<void> {
  await db.items.update(id, { ...changes, updatedAt: Date.now() })
}

export async function deleteItem(id: number): Promise<void> {
  await db.items.delete(id)
  await db.edges.where('fromId').equals(id).delete()
  await db.edges.where('toId').equals(id).delete()
  await deleteAttachmentsForItem(id)
}

export async function getAllItems(): Promise<ResearchItem[]> {
  return db.items.orderBy('createdAt').reverse().toArray()
}

export async function exportAllData() {
  const [items, themes, concepts, edges] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
    db.concepts.toArray(),
    db.edges.toArray(),
  ])
  return { items, themes, concepts, edges, exportedAt: new Date().toISOString() }
}
