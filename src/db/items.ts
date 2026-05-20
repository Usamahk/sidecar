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

export const BACKUP_FORMAT_VERSION = 3

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
  concepts: any[]
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
  conversations: any[]
  messages: any[]
}

export async function exportAllData(): Promise<BackupPayload> {
  const [items, themes, concepts, edges, attachmentRows, settings, suggestions, rejections, conversations, messages] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
    db.concepts.toArray(),
    db.edges.toArray(),
    db.attachments.toArray(),
    db.settings.toArray(),
    db.suggestions.toArray(),
    db.rejections.toArray(),
    db.conversations.toArray(),
    db.messages.toArray(),
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

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: db.verno,
    items,
    themes,
    concepts,
    edges,
    attachments,
    settings,
    suggestions,
    rejections,
    conversations,
    messages,
  }
}

export interface ImportSummary {
  items: number
  themes: number
  concepts: number
  edges: number
  attachments: number
  settings: number
  suggestions: number
  rejections: number
  conversations: number
  messages: number
}

export function summarize(payload: BackupPayload): ImportSummary {
  return {
    items: payload.items?.length ?? 0,
    themes: payload.themes?.length ?? 0,
    concepts: payload.concepts?.length ?? 0,
    edges: payload.edges?.length ?? 0,
    attachments: payload.attachments?.length ?? 0,
    settings: payload.settings?.length ?? 0,
    suggestions: payload.suggestions?.length ?? 0,
    rejections: payload.rejections?.length ?? 0,
    conversations: payload.conversations?.length ?? 0,
    messages: payload.messages?.length ?? 0,
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
    concepts: p.concepts ?? [],
    edges: p.edges ?? [],
    attachments: p.attachments ?? [],
    settings: p.settings ?? [],
    suggestions: p.suggestions ?? [],
    rejections: p.rejections ?? [],
    conversations: p.conversations ?? [],
    messages: p.messages ?? [],
  }
}

export async function importAllData(payload: BackupPayload): Promise<ImportSummary> {
  await db.transaction(
    'rw',
    [db.items, db.themes, db.concepts, db.edges, db.attachments, db.settings, db.suggestions, db.rejections, db.conversations, db.messages],
    async () => {
      await Promise.all([
        db.items.clear(),
        db.themes.clear(),
        db.concepts.clear(),
        db.edges.clear(),
        db.attachments.clear(),
        db.suggestions.clear(),
        db.rejections.clear(),
        db.conversations.clear(),
        db.messages.clear(),
      ])

      if (payload.items.length > 0) await db.items.bulkAdd(payload.items as any)
      if (payload.themes.length > 0) await db.themes.bulkAdd(payload.themes as any)
      if (payload.concepts.length > 0) await db.concepts.bulkAdd(payload.concepts as any)
      if (payload.edges.length > 0) await db.edges.bulkAdd(payload.edges as any)
      if (payload.suggestions.length > 0) await db.suggestions.bulkAdd(payload.suggestions as any)
      if (payload.rejections.length > 0) await db.rejections.bulkAdd(payload.rejections as any)
      if (payload.conversations.length > 0) await db.conversations.bulkAdd(payload.conversations as any)
      if (payload.messages.length > 0) await db.messages.bulkAdd(payload.messages as any)

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
          await db.settings.put(s)
        }
      }
    }
  )

  return summarize(payload)
}
