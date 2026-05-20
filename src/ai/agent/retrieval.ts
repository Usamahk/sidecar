import Fuse from 'fuse.js'
import { db } from '@/db/schema'
import type { AgentCitation, ResearchItem, Theme } from '@/types'

export interface RetrievalHit {
  item: ResearchItem
  snippet: string
  score: number
  citation: AgentCitation
}

const SNIPPET_LIMIT = 280

function normalize(str: string): string {
  return str.toLowerCase().replace(/\s+/g, ' ').trim()
}

function trimSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LIMIT ? `${flat.slice(0, SNIPPET_LIMIT)}…` : flat
}

function recencyBonus(createdAt: number): number {
  const days = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  return Math.max(0, 0.15 - Math.min(days, 45) / 300)
}

function makeCitation(item: ResearchItem, snippet: string): AgentCitation {
  return {
    kind: 'item',
    refId: `S${item.id}`,
    title: item.pageTitle || item.domain || `Item ${item.id}`,
    url: item.url,
    snippet,
    itemId: item.id,
    domain: item.domain,
    date: item.date,
  }
}

function buildRankedHits(
  query: string,
  items: ResearchItem[],
  themes: Theme[],
  maxHits: number
): RetrievalHit[] {
  const themeMap = new Map(themes.map((t) => [t.id!, t.name.toLowerCase()]))
  const searchable = items.map((item) => ({
    item,
    text: `${item.rawContent || item.content}\n${item.notes}\n${item.url}\n${item.pageTitle}\n${item.sourceSender}`,
  }))
  const fuse = new Fuse(searchable, {
    includeScore: true,
    threshold: 0.42,
    keys: ['text'],
  })
  const q = normalize(query)
  const raw = fuse.search(q, { limit: Math.max(maxHits * 2, 10) })
  const ranked = raw.map((r) => {
    const base = 1 - (r.score ?? 1)
    const item = r.item.item
    const themeBoost = item.themeIds.some((id) => (themeMap.get(id) ?? '').includes(q)) ? 0.12 : 0
    const notesBoost = normalize(item.notes).includes(q) ? 0.1 : 0
    const score = base + themeBoost + notesBoost + recencyBonus(item.createdAt)
    const snippet = trimSnippet(item.rawContent || item.content)
    return {
      item,
      snippet,
      score,
      citation: makeCitation(item, snippet),
    }
  })
  return ranked.sort((a, b) => b.score - a.score).slice(0, maxHits)
}

export async function retrieveCorpusContext(
  query: string,
  maxHits: number
): Promise<RetrievalHit[]> {
  const [items, themes] = await Promise.all([db.items.toArray(), db.themes.toArray()])
  if (items.length === 0) return []
  return buildRankedHits(query, items, themes, maxHits)
}
