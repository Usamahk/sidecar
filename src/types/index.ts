export type SourceType = 'newsletter' | 'website' | 'twitter' | 'reddit' | 'product' | 'internal'

export interface ResearchItem {
  id?: number
  content: string       // markdown-rendered content
  rawContent: string    // original pasted text
  url: string
  domain: string
  pageTitle: string
  date: string          // ISO date string, user-editable
  notes: string
  sourceType: SourceType
  sourceSender: string  // newsletter sender name, or label for internal items
  themeIds: number[]
  conceptIds: number[]
  createdAt: number
  updatedAt: number
}

export interface Theme {
  id?: number
  name: string
  description: string
  color: string         // hex color
  createdAt: number
}

export interface Concept {
  id?: number
  name: string
  description: string
}

export interface Edge {
  id?: number
  fromId: number
  fromType: 'item' | 'theme' | 'concept'
  toId: number
  toType: 'item' | 'theme' | 'concept'
  type: 'item-theme' | 'item-concept' | 'item-item' | 'concept-concept'
  weight: number
}

export interface Attachment {
  id?: number
  itemId: number
  blob: Blob
  mimeType: string
  name: string
  createdAt: number
}

export interface Setting {
  key: string
  value: string
}

export interface StoredHandle {
  key: string
  handle: FileSystemDirectoryHandle
  createdAt: number
}

export type SuggestionKind = 'assignment' | 'proposal'

export interface Rejection {
  id?: number
  kind: SuggestionKind
  createdAt: number

  // For 'assignment': the (item, theme) pair the user said no to
  itemId?: number
  themeId?: number

  // For 'proposal': the normalized lowercase name we should not re-suggest
  proposedNameLower?: string
}

export interface Suggestion {
  id?: number
  kind: SuggestionKind
  scanId: string
  createdAt: number

  // For 'assignment': tag an existing item with an existing theme
  itemId?: number
  themeId?: number
  confidence?: number   // 0..1

  // For 'proposal': a new theme name + items that would belong to it
  proposedName?: string
  proposedDescription?: string
  proposedColor?: string
  supportingItemIds?: number[]
}

export type View = 'timeline' | 'themes' | 'graph' | 'agent' | 'settings'

export interface TabInfo {
  url: string
  title: string
  favIconUrl?: string
  senderName?: string   // extracted from Gmail DOM when on mail.google.com
}
