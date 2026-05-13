import Dexie, { type EntityTable } from 'dexie'
import type { ResearchItem, Theme, Concept, Edge, Attachment, Setting } from '@/types'

class SidecarDB extends Dexie {
  items!: EntityTable<ResearchItem, 'id'>
  themes!: EntityTable<Theme, 'id'>
  concepts!: EntityTable<Concept, 'id'>
  edges!: EntityTable<Edge, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  settings!: EntityTable<Setting, 'key'>

  constructor() {
    super('SidecarDB')
    this.version(1).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      settings: 'key',
    })
    // Version 2 adds the attachments table — existing data is untouched
    this.version(2).stores({
      items: '++id, url, domain, date, createdAt, *themeIds, *conceptIds',
      themes: '++id, name',
      concepts: '++id, name',
      edges: '++id, fromId, toId, type',
      attachments: '++id, itemId, createdAt',
      settings: 'key',
    })
  }
}

export const db = new SidecarDB()
