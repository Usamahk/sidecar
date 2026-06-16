import { db } from './schema'
import type { ResearchItem, Theme } from '@/types'

// Insights are NOT rendered as graph nodes — they appear as ambient blobs
// drawn around their supporting themes + items. Only items and themes are
// node-level citizens of the force-directed layout.
export type NodeType = 'item' | 'theme'
export type LinkType = 'item-theme' | 'theme-theme'

export interface GraphNode {
  id: string
  refId: number
  label: string
  type: NodeType
  color: string
  val: number
  degree: number
  data: ResearchItem | Theme
}

export interface GraphLink {
  source: string
  target: string
  type: LinkType
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

const COOCCUR_MIN_WEIGHT = 2

function nodeKey(type: NodeType, id: number): string {
  return `${type}-${id}`
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

function* pairsOf<T>(xs: T[]): Generator<[T, T]> {
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      yield [xs[i], xs[j]]
    }
  }
}

export interface BuildOpts {
  hideOrphanItems?: boolean
}

export async function buildGraphData(opts: BuildOpts = {}): Promise<GraphData> {
  const [items, themes] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
  ])

  const themeById = new Map<number, Theme>(themes.map((t: Theme) => [t.id!, t]))

  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const degree = new Map<string, number>()

  function bumpDegree(key: string) {
    degree.set(key, (degree.get(key) ?? 0) + 1)
  }

  // Item ↔ theme (direct, from item.themeIds)
  for (const item of items) {
    if (item.id == null) continue
    const itemKey = nodeKey('item', item.id)
    for (const themeId of item.themeIds ?? []) {
      if (!themeById.has(themeId)) continue
      const themeKey = nodeKey('theme', themeId)
      links.push({ source: itemKey, target: themeKey, type: 'item-theme', weight: 1 })
      bumpDegree(itemKey)
      bumpDegree(themeKey)
    }
  }

  // Theme ↔ theme co-occurrence (themes that share items)
  const themePairCounts = new Map<string, { a: number; b: number; count: number }>()
  for (const item of items) {
    const ids: number[] = (item.themeIds ?? []).filter((id: number) => themeById.has(id))
    for (const [a, b] of pairsOf(ids)) {
      const k = a < b ? `${a}::${b}` : `${b}::${a}`
      const entry = themePairCounts.get(k)
      if (entry) entry.count++
      else themePairCounts.set(k, { a: Math.min(a, b), b: Math.max(a, b), count: 1 })
    }
  }
  for (const { a, b, count } of themePairCounts.values()) {
    if (count < COOCCUR_MIN_WEIGHT) continue
    const ak = nodeKey('theme', a)
    const bk = nodeKey('theme', b)
    links.push({ source: ak, target: bk, type: 'theme-theme', weight: count })
    bumpDegree(ak)
    bumpDegree(bk)
  }

  // Dedupe links by undirected endpoints + type.
  const seen = new Set<string>()
  const dedupedLinks: GraphLink[] = []
  for (const l of links) {
    const key = `${linkKey(l.source, l.target)}::${l.type}`
    if (seen.has(key)) continue
    seen.add(key)
    dedupedLinks.push(l)
  }

  // Materialize nodes.
  for (const item of items) {
    if (item.id == null) continue
    const key = nodeKey('item', item.id)
    const d = degree.get(key) ?? 0
    if (opts.hideOrphanItems && d === 0) continue
    nodes.push({
      id: key,
      refId: item.id,
      label: item.pageTitle || item.domain || item.url.slice(0, 40) || `Item ${item.id}`,
      type: 'item',
      color: 'var(--ink-3)',
      degree: d,
      val: 1 + d * 0.5,
      data: item,
    })
  }
  for (const theme of themes) {
    if (theme.id == null) continue
    const key = nodeKey('theme', theme.id)
    const d = degree.get(key) ?? 0
    nodes.push({
      id: key,
      refId: theme.id,
      label: theme.name,
      type: 'theme',
      color: theme.color,
      degree: d,
      val: 3 + d * 0.4,
      data: theme,
    })
  }
  // Insights are NOT rendered as nodes — they appear as ambient blobs.

  return { nodes, links: dedupedLinks }
}
