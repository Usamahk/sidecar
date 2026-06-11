import { db } from './schema'
import type { ResearchItem, Theme, Concept } from '@/types'

export type NodeType = 'item' | 'theme' | 'concept'
export type LinkType =
  | 'item-theme'
  | 'item-concept'
  | 'theme-theme'
  | 'concept-concept'
  | 'theme-concept'

export interface GraphNode {
  id: string
  refId: number
  label: string
  type: NodeType
  color: string
  val: number
  degree: number
  data: ResearchItem | Theme | Concept
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

// Co-occurrence threshold — pairs that appear together in fewer than this many
// items don't get a derived link. Prevents one-off matches from spawning noise.
const COOCCUR_MIN_WEIGHT = 2

function nodeKey(type: NodeType, id: number): string {
  return `${type}-${id}`
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

function tally<T>(pairs: Iterable<[T, T]>): Map<string, { a: T; b: T; count: number }> {
  const tallies = new Map<string, { a: T; b: T; count: number }>()
  for (const [a, b] of pairs) {
    const key = String(a) < String(b) ? `${a}::${b}` : `${b}::${a}`
    const entry = tallies.get(key)
    if (entry) entry.count++
    else tallies.set(key, { a, b, count: 1 })
  }
  return tallies
}

function* pairsOf<T>(xs: T[]): Generator<[T, T]> {
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      yield [xs[i], xs[j]]
    }
  }
}

export interface BuildOpts {
  /** If set, drop item nodes with degree 0 (no theme or concept links). */
  hideOrphanItems?: boolean
}

export async function buildGraphData(opts: BuildOpts = {}): Promise<GraphData> {
  const [items, themes, concepts] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
    db.concepts.toArray(),
  ])

  const themeById = new Map<number, Theme>(themes.map((t: Theme) => [t.id!, t]))
  const conceptById = new Map<number, Concept>(concepts.map((c: Concept) => [c.id!, c]))

  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const degree = new Map<string, number>()

  function bumpDegree(key: string) {
    degree.set(key, (degree.get(key) ?? 0) + 1)
  }

  // Item ↔ theme + item ↔ concept (direct)
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
    for (const conceptId of item.conceptIds ?? []) {
      if (!conceptById.has(conceptId)) continue
      const conceptKey = nodeKey('concept', conceptId)
      links.push({ source: itemKey, target: conceptKey, type: 'item-concept', weight: 1 })
      bumpDegree(itemKey)
      bumpDegree(conceptKey)
    }
  }

  // Theme ↔ theme co-occurrence (themes that share items)
  const themePairs: [number, number][] = []
  for (const item of items) {
    const ids: number[] = (item.themeIds ?? []).filter((id: number) => themeById.has(id))
    for (const pair of pairsOf(ids)) themePairs.push(pair)
  }
  for (const { a, b, count } of tally<number>(themePairs).values()) {
    if (count < COOCCUR_MIN_WEIGHT) continue
    const ak = nodeKey('theme', a)
    const bk = nodeKey('theme', b)
    links.push({ source: ak, target: bk, type: 'theme-theme', weight: count })
    bumpDegree(ak)
    bumpDegree(bk)
  }

  // Concept ↔ concept co-occurrence
  const conceptPairs: [number, number][] = []
  for (const item of items) {
    const ids: number[] = (item.conceptIds ?? []).filter((id: number) => conceptById.has(id))
    for (const pair of pairsOf(ids)) conceptPairs.push(pair)
  }
  for (const { a, b, count } of tally<number>(conceptPairs).values()) {
    if (count < COOCCUR_MIN_WEIGHT) continue
    const ak = nodeKey('concept', a)
    const bk = nodeKey('concept', b)
    links.push({ source: ak, target: bk, type: 'concept-concept', weight: count })
    bumpDegree(ak)
    bumpDegree(bk)
  }

  // Theme ↔ concept co-occurrence (items that carry both)
  const themeConceptPairs: [number, number][] = []
  for (const item of items) {
    const tIds = (item.themeIds ?? []).filter((id: number) => themeById.has(id))
    const cIds = (item.conceptIds ?? []).filter((id: number) => conceptById.has(id))
    for (const t of tIds) for (const c of cIds) themeConceptPairs.push([t, c])
  }
  // For this cross-pair we want the same key regardless of which side is theme/concept,
  // but the orientation matters for link type — keep theme-side as source.
  const themeConceptTally = new Map<string, { themeId: number; conceptId: number; count: number }>()
  for (const [themeId, conceptId] of themeConceptPairs) {
    const key = `${themeId}::${conceptId}`
    const entry = themeConceptTally.get(key)
    if (entry) entry.count++
    else themeConceptTally.set(key, { themeId, conceptId, count: 1 })
  }
  for (const { themeId, conceptId, count } of themeConceptTally.values()) {
    if (count < COOCCUR_MIN_WEIGHT) continue
    const tk = nodeKey('theme', themeId)
    const ck = nodeKey('concept', conceptId)
    links.push({ source: tk, target: ck, type: 'theme-concept', weight: count })
    bumpDegree(tk)
    bumpDegree(ck)
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

  // Materialize nodes with degree-based sizes.
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
      color: 'var(--ink-2)',
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
  for (const concept of concepts) {
    if (concept.id == null) continue
    const key = nodeKey('concept', concept.id)
    const d = degree.get(key) ?? 0
    nodes.push({
      id: key,
      refId: concept.id,
      label: concept.name,
      type: 'concept',
      color: 'var(--accent)',
      degree: d,
      val: 2 + d * 0.4,
      data: concept,
    })
  }

  return { nodes, links: dedupedLinks }
}
