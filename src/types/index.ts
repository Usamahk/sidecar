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

/**
 * An emergent pattern the AI surfaced from looking across themes — a claim about
 * what threads are forming in the corpus. Insights embed their own evidence
 * (themeIds + itemIds) rather than being tagged onto items the way themes are.
 */
export interface Insight {
  id?: number
  headline: string          // short claim, e.g. "Rise of robotics startup chatter"
  rationale: string         // 1–2 sentences explaining the pattern
  themeIds: number[]        // supporting themes (the substrate)
  itemIds: number[]         // supporting items (the evidence)
  strength: number          // 0..1 model confidence in the pattern
  generatedAt: number       // ms epoch when this insight was created
}

export interface Edge {
  id?: number
  fromId: number
  fromType: 'item' | 'theme' | 'insight'
  toId: number
  toType: 'item' | 'theme' | 'insight'
  type: 'item-theme' | 'insight-theme' | 'insight-item'
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

export type SuggestionKind =
  | 'assignment'         // (item, theme) tagging suggestion
  | 'proposal'           // proposed new theme
  | 'insight-proposal'   // proposed emergent insight (theme co-occurrence pattern)

export interface Rejection {
  id?: number
  kind: SuggestionKind
  createdAt: number

  // For theme 'assignment': the (item, theme) pair the user said no to
  itemId?: number
  themeId?: number

  // For 'proposal' / 'insight-proposal': normalized lowercase headline
  // we should not re-propose.
  proposedNameLower?: string
}

export interface Suggestion {
  id?: number
  kind: SuggestionKind
  scanId: string
  createdAt: number

  // For theme 'assignment'
  itemId?: number
  themeId?: number
  confidence?: number

  // For theme 'proposal'
  proposedName?: string
  proposedDescription?: string
  proposedColor?: string
  supportingItemIds?: number[]

  // For 'insight-proposal'
  proposedHeadline?: string
  proposedRationale?: string
  supportingThemeIds?: number[]
  strength?: number       // 0..1
}

export type AgentResponseMode = 'concise' | 'detailed'

export interface AgentConversation {
  id?: number
  title: string
  lastMessagePreview: string
  createdAt: number
  updatedAt: number
}

export type CitationKind = 'item' | 'web'

export interface AgentCitation {
  kind: CitationKind
  refId: string
  title: string
  url?: string
  snippet: string
  itemId?: number
  domain?: string
  date?: string
}

export interface AgentMessage {
  id?: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  citations: AgentCitation[]
  usedWeb: boolean
  model: string
  createdAt: number
}
export type View = 'timeline' | 'themes' | 'graph' | 'agent' | 'settings'

export interface TabInfo {
  url: string
  title: string
  favIconUrl?: string
  senderName?: string   // extracted from Gmail DOM when on mail.google.com
}
