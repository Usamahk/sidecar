import Dexie, { type EntityTable } from 'dexie'
import type {
  ResearchItem,
  Theme,
  Concept,
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
  concepts!: EntityTable<Concept, 'id'>
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
  }
}

export const db = new SidecarDB()
