import { db } from './schema'
import type { ResearchItem, SourceType } from '@/types'
import { deleteAttachmentsForItem } from './attachments'
import { getDecisionMachine } from '@/ai/ms/client'
import {
  MS_SOURCE_TYPE_MIN_CONFIDENCE,
  MS_SOURCE_TYPE_MIN_PROBABILITY,
  MS_SOURCE_TYPE_SAMPLE_CHARS,
  SOURCE_TYPE_LABELS,
} from '@/ai/ms/constants'

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function hostnameRule(url: string): SourceType | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    if (hostname === 'mail.google.com') return 'newsletter'
    if (hostname === 'twitter.com' || hostname === 'x.com') return 'twitter'
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) return 'reddit'
  } catch {}
  return null
}

/**
 * Detect the SourceType. Fast hostname rules short-circuit (no API call).
 * When they miss, and a Milliseconds key is set, classify over the captured
 * title + snippet to catch Substack/Beehiiv newsletters, product pages, and
 * local notes that the hostname-only path flattens to 'website'. On no key
 * or any error, keep the historical 'website' default.
 */
async function detectSourceType(url: string, pageTitle: string, rawContent: string): Promise<SourceType> {
  const byHost = hostnameRule(url)
  if (byHost !== null) return byHost

  const dm = await getDecisionMachine()
  if (!dm) return 'website'

  // Include the URL so the 'internal' label's "no URL" marker actually
  // discriminates — a first-person essay on the web would otherwise fire it.
  const urlLine = url ? `URL: ${url}` : 'URL: (none — local note)'
  const text = `${urlLine}\n${pageTitle || ''}\n\n${(rawContent || '').slice(0, MS_SOURCE_TYPE_SAMPLE_CHARS)}`.trim()
  if (!text) return 'website'

  try {
    const result = await dm.classify(text, SOURCE_TYPE_LABELS)
    // Gate on probability AND confidence — the SourceType labels overlap, so
    // probability alone is thin. Confidence (1 − normalised entropy) catches
    // the "two labels both scored high" split where the argmax is a coin toss.
    if (
      result.probability >= MS_SOURCE_TYPE_MIN_PROBABILITY &&
      result.confidence >= MS_SOURCE_TYPE_MIN_CONFIDENCE
    ) {
      return result.label as SourceType
    }
    return 'website'
  } catch (err) {
    console.warn('[items] milliseconds source-type classify failed, falling back to website:', err)
    return 'website'
  }
}

export async function addItem(
  partial: Pick<ResearchItem, 'rawContent' | 'url' | 'pageTitle' | 'date'> & { sourceSender?: string }
): Promise<number> {
  const now = Date.now()
  const sourceType = await detectSourceType(partial.url, partial.pageTitle, partial.rawContent)
  return db.items.add({
    content: partial.rawContent,
    rawContent: partial.rawContent,
    url: partial.url,
    domain: domainFromUrl(partial.url),
    pageTitle: partial.pageTitle,
    date: partial.date,
    notes: '',
    sourceType,
    sourceSender: partial.sourceSender ?? '',
    themeIds: [],
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

export const BACKUP_FORMAT_VERSION = 5

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

export interface BackupPayload {
  formatVersion: number
  exportedAt: string
  schemaVersion: number
  items: any[]
  themes: any[]
  insights: any[]
  edges: any[]
  attachments: Array<{
    id?: number
    itemId: number
    mimeType: string
    name: string
    createdAt: number
    dataB64: string
  }>
  settings: any[]
  suggestions: any[]
  rejections: any[]
}

export async function exportAllData(): Promise<BackupPayload> {
  const [items, themes, insights, edges, attachmentRows, settings, suggestions, rejections] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
    db.insights.toArray(),
    db.edges.toArray(),
    db.attachments.toArray(),
    db.settings.toArray(),
    db.suggestions.toArray(),
    db.rejections.toArray(),
  ])

  const attachments = await Promise.all(
    attachmentRows.map(async (a: any) => ({
      id: a.id,
      itemId: a.itemId,
      mimeType: a.mimeType,
      name: a.name,
      createdAt: a.createdAt,
      dataB64: await blobToBase64(a.blob),
    }))
  )

  // Defense-in-depth: never export secrets. The API key lives in
  // chrome.storage.local now, but filter any stale settings row just in case.
  const safeSettings = settings.filter((s: any) => s?.key !== 'anthropicApiKey')

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: db.verno,
    items,
    themes,
    insights,
    edges,
    attachments,
    settings: safeSettings,
    suggestions,
    rejections,
  }
}

export interface ImportSummary {
  items: number
  themes: number
  insights: number
  edges: number
  attachments: number
  settings: number
  suggestions: number
  rejections: number
}

export function summarize(payload: BackupPayload): ImportSummary {
  return {
    items: payload.items?.length ?? 0,
    themes: payload.themes?.length ?? 0,
    insights: payload.insights?.length ?? 0,
    edges: payload.edges?.length ?? 0,
    attachments: payload.attachments?.length ?? 0,
    settings: payload.settings?.length ?? 0,
    suggestions: payload.suggestions?.length ?? 0,
    rejections: payload.rejections?.length ?? 0,
  }
}

export function validateBackup(raw: unknown): BackupPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Backup file is not a valid object')
  const p = raw as Partial<BackupPayload>
  if (!Array.isArray(p.items)) throw new Error('Backup is missing required "items" array')
  if (!Array.isArray(p.themes)) throw new Error('Backup is missing required "themes" array')
  return {
    formatVersion: p.formatVersion ?? 1,
    exportedAt: p.exportedAt ?? new Date().toISOString(),
    schemaVersion: p.schemaVersion ?? 0,
    items: p.items,
    themes: p.themes,
    insights: p.insights ?? (p as any).concepts ?? [],
    edges: p.edges ?? [],
    attachments: p.attachments ?? [],
    settings: p.settings ?? [],
    suggestions: p.suggestions ?? [],
    rejections: p.rejections ?? [],
  }
}

export async function importAllData(payload: BackupPayload): Promise<ImportSummary> {
  await db.transaction(
    'rw',
    [db.items, db.themes, db.insights, db.edges, db.attachments, db.settings, db.suggestions, db.rejections],
    async () => {
      await Promise.all([
        db.items.clear(),
        db.themes.clear(),
        db.insights.clear(),
        db.edges.clear(),
        db.attachments.clear(),
        db.suggestions.clear(),
        db.rejections.clear(),
      ])

      if (payload.items.length > 0) await db.items.bulkAdd(payload.items as any)
      if (payload.themes.length > 0) await db.themes.bulkAdd(payload.themes as any)
      if (payload.insights.length > 0) await db.insights.bulkAdd(payload.insights as any)
      if (payload.edges.length > 0) await db.edges.bulkAdd(payload.edges as any)
      if (payload.suggestions.length > 0) await db.suggestions.bulkAdd(payload.suggestions as any)
      if (payload.rejections.length > 0) await db.rejections.bulkAdd(payload.rejections as any)

      if (payload.attachments.length > 0) {
        const rows = payload.attachments.map((a) => ({
          id: a.id,
          itemId: a.itemId,
          blob: base64ToBlob(a.dataB64, a.mimeType),
          mimeType: a.mimeType,
          name: a.name,
          createdAt: a.createdAt,
        }))
        await db.attachments.bulkAdd(rows as any)
      }

      // Settings: merge instead of clear-and-replace so we don't lose backup-folder handles
      // and other local-only keys when restoring on a fresh machine.
      for (const s of payload.settings) {
        if (s && typeof s.key === 'string') {
          // Skip the folder handle key — that's machine-local, not portable.
          if (s.key === 'backupFolderHandle') continue
          // Never re-import the API key into IndexedDB (it lives in
          // chrome.storage.local); old backups may still carry it.
          if (s.key === 'anthropicApiKey') continue
          await db.settings.put(s)
        }
      }
    }
  )

  return summarize(payload)
}
