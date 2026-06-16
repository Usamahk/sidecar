import Dexie, { type EntityTable } from 'dexie'
import type {
  ResearchItem,
  Theme,
  Insight,
  Edge,
  Attachment,
  Setting,
  Suggestion,
  Rejection,
  StoredHandle,
  AgentConversation,
  AgentMessage,
} from '@/types'

class SidecarDB extends Dexie {
  items!: EntityTable<ResearchItem, 'id'>
  themes!: EntityTable<Theme, 'id'>
  insights!: EntityTable<Insight, 'id'>
  edges!: EntityTable<Edge, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  settings!: EntityTable<Setting, 'key'>
  suggestions!: EntityTable<Suggestion, 'id'>
  rejections!: EntityTable<Rejection, 'id'>
  fileHandles!: EntityTable<StoredHandle, 'key'>
  conversations!: EntityTable<AgentConversation, 'id'>
  messages!: EntityTable<AgentMessage, 'id'>

  constructor() {
    super('SidecarDB')
    this.version(1).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      settings: 'key',
    })
    this.version(2).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
    })
    this.version(3).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, createdAt',
    })
    this.version(4).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, createdAt',
      rejections: '++id, kind, itemId, themeId, proposedNameLower, [itemId+themeId]',
    })
    this.version(5).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, createdAt',
      rejections: '++id, kind, itemId, themeId, proposedNameLower, [itemId+themeId]',
      fileHandles: 'key',
    })
    this.version(6).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, createdAt',
      rejections: '++id, kind, itemId, themeId, proposedNameLower, [itemId+themeId]',
      fileHandles: 'key',
      conversations: '++id, updatedAt, createdAt',
      messages: '++id, conversationId, createdAt, role',
    })
    this.version(7).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, conceptId, createdAt',
      rejections: '++id, kind, itemId, themeId, conceptId, proposedNameLower, [itemId+themeId], [itemId+conceptId]',
      fileHandles: 'key',
      conversations: '++id, updatedAt, createdAt',
      messages: '++id, conversationId, createdAt, role',
    })
    // v8 reframes the third tier from "concepts" (named entities) to "insights"
    // (emergent cross-theme patterns). The old concepts table is dropped; any
    // existing concept rows are migrated to insight placeholders so the user
    // can review/delete them. Items drop the conceptIds index.
    this.version(8).stores({
      items: '++id, url, domain, date, createdAt, *themeIds',
      themes: '++id, name',
      concepts: null,
      insights: '++id, generatedAt, *themeIds, *itemIds',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
      suggestions: '++id, kind, scanId, themeId, createdAt',
      rejections: '++id, kind, itemId, themeId, proposedNameLower, [itemId+themeId]',
      fileHandles: 'key',
      conversations: '++id, updatedAt, createdAt',
      messages: '++id, conversationId, createdAt, role',
    }).upgrade(async (tx) => {
      const now = Date.now()
      // Migrate any existing concept rows into insight placeholders.
      const oldConcepts = await tx.table('concepts').toArray().catch(() => [] as any[])
      for (const c of oldConcepts) {
        await tx.table('insights').add({
          headline: c.name ?? 'Untitled insight',
          rationale: c.description ?? '(migrated from a v0.6 concept — review or delete)',
          themeIds: [],
          itemIds: [],
          strength: 0.5,
          generatedAt: now,
        })
      }
      // Strip conceptIds from items (the index is gone; remove the field too).
      await tx.table('items').toCollection().modify((item: any) => {
        delete item.conceptIds
      })
      // Drop concept-* suggestion + rejection rows; their referenced concept
      // ids no longer exist as a stable target.
      await tx.table('suggestions').toCollection().modify((s: any, ref: any) => {
        if (s.kind === 'concept-assignment' || s.kind === 'concept-proposal') {
          delete ref.value
        }
      })
      await tx.table('rejections').toCollection().modify((r: any, ref: any) => {
        if (r.kind === 'concept-assignment' || r.kind === 'concept-proposal') {
          delete ref.value
        }
      })
      // Drop dangling item-concept / concept-concept edges.
      await tx.table('edges').toCollection().modify((e: any, ref: any) => {
        if (e.fromType === 'concept' || e.toType === 'concept') {
          delete ref.value
        }
      })
    })
  }
}

export const db = new SidecarDB()
