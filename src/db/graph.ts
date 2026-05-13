import { db } from './schema'
import type { ResearchItem, Theme, Concept } from '@/types'

export interface GraphNode {
  id: string
  label: string
  type: 'item' | 'theme' | 'concept'
  color: string
  val: number     // node size
  data: ResearchItem | Theme | Concept
}

export interface GraphLink {
  source: string
  target: string
  type: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

const NODE_COLORS = {
  item: '#6366f1',
  theme: '#22c55e',
  concept: '#f97316',
}

export async function buildGraphData(): Promise<GraphData> {
  const [items, themes, concepts, edges] = await Promise.all([
    db.items.toArray(),
    db.themes.toArray(),
    db.concepts.toArray(),
    db.edges.toArray(),
  ])

  const nodes: GraphNode[] = [
    ...items.map((item) => ({
      id: `item-${item.id}`,
      label: item.domain || item.url.slice(0, 40),
      type: 'item' as const,
      color: NODE_COLORS.item,
      val: 1 + (item.themeIds.length + item.conceptIds.length) * 0.5,
      data: item,
    })),
    ...themes.map((theme) => ({
      id: `theme-${theme.id}`,
      label: theme.name,
      type: 'theme' as const,
      color: theme.color,
      val: 3,
      data: theme,
    })),
    ...concepts.map((concept) => ({
      id: `concept-${concept.id}`,
      label: concept.name,
      type: 'concept' as const,
      color: NODE_COLORS.concept,
      val: 2,
      data: concept,
    })),
  ]

  const links: GraphLink[] = edges.map((edge) => ({
    source: `${edge.fromType}-${edge.fromId}`,
    target: `${edge.toType}-${edge.toId}`,
    type: edge.type,
  }))

  return { nodes, links }
}
