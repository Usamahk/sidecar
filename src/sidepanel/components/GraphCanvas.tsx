import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphNode, NodeType } from '@/db/graph'

interface Props {
  data: GraphData
  width: number
  height: number
  visibleTypes: Set<NodeType>
  search: string
  selectedId: string | null
  onSelect: (node: GraphNode | null) => void
}

// react-force-graph-2d augments node objects with mutable x/y/vx/vy. The library
// expects the same object references between renders, so we cache by id.
interface CanvasNode extends GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  __cssColor?: string
}

interface CanvasLink {
  source: string | CanvasNode
  target: string | CanvasNode
  type: string
  weight: number
  __cssColor?: string
}

function resolveCssColor(value: string, fallback: string): string {
  if (!value.startsWith('var(')) return value
  const varName = value.slice(4, -1).trim()
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}

export function GraphCanvas({
  data,
  width,
  height,
  visibleTypes,
  search,
  selectedId,
  onSelect,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<CanvasNode, CanvasLink>>(undefined as any)
  const nodeCache = useRef<Map<string, CanvasNode>>(new Map())
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Resolve CSS variable colors once per theme change. We re-resolve when the
  // document's `dark` class flips by listening for class-attribute mutations.
  const [palette, setPalette] = useState(() => ({
    ink: resolveCssColor('var(--ink-2)', '#5C584F'),
    ink3: resolveCssColor('var(--ink-3)', '#9C978B'),
    line: resolveCssColor('var(--line)', '#E8E4DA'),
    lineStrong: resolveCssColor('var(--line-strong)', '#D7D2C6'),
    accent: resolveCssColor('var(--accent)', '#E0604F'),
    surface: resolveCssColor('var(--surface)', '#FCFBF9'),
  }))

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setPalette({
        ink: resolveCssColor('var(--ink-2)', '#5C584F'),
        ink3: resolveCssColor('var(--ink-3)', '#9C978B'),
        line: resolveCssColor('var(--line)', '#E8E4DA'),
        lineStrong: resolveCssColor('var(--line-strong)', '#D7D2C6'),
        accent: resolveCssColor('var(--accent)', '#E0604F'),
        surface: resolveCssColor('var(--surface)', '#FCFBF9'),
      })
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // Filter + materialize canvas nodes/links, preserving previous object identity
  // so the force simulation doesn't kick every render.
  const { nodes, links, visibleIds } = useMemo(() => {
    const filteredNodes: CanvasNode[] = []
    const nextCache = new Map<string, CanvasNode>()
    const ids = new Set<string>()

    for (const n of data.nodes) {
      if (!visibleTypes.has(n.type)) continue
      const cached = nodeCache.current.get(n.id)
      const merged: CanvasNode = cached
        ? Object.assign(cached, n, {
            __cssColor: n.color.startsWith('var(')
              ? n.type === 'concept' ? palette.accent : palette.ink
              : n.color,
          })
        : {
            ...n,
            __cssColor: n.color.startsWith('var(')
              ? n.type === 'concept' ? palette.accent : palette.ink
              : n.color,
          }
      filteredNodes.push(merged)
      nextCache.set(n.id, merged)
      ids.add(n.id)
    }
    nodeCache.current = nextCache

    const filteredLinks: CanvasLink[] = []
    for (const l of data.links) {
      if (!ids.has(l.source as string) || !ids.has(l.target as string)) continue
      filteredLinks.push({
        source: l.source,
        target: l.target,
        type: l.type,
        weight: l.weight,
        __cssColor: palette.line,
      })
    }

    return { nodes: filteredNodes, links: filteredLinks, visibleIds: ids }
  }, [data, visibleTypes, palette])

  // Compute search-match set + neighbour highlight for the selected node.
  const { matchedIds, neighborIds } = useMemo(() => {
    const matched = new Set<string>()
    const q = search.trim().toLowerCase()
    if (q) {
      for (const n of nodes) {
        if (n.label.toLowerCase().includes(q)) matched.add(n.id)
      }
    }
    const neighbors = new Set<string>()
    if (selectedId) {
      neighbors.add(selectedId)
      for (const l of links) {
        const s = typeof l.source === 'string' ? l.source : (l.source as CanvasNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as CanvasNode).id
        if (s === selectedId) neighbors.add(t)
        if (t === selectedId) neighbors.add(s)
      }
    }
    return { matchedIds: matched, neighborIds: neighbors }
  }, [nodes, links, search, selectedId])

  const hasSearch = search.trim().length > 0
  const hasSelection = selectedId != null

  // Fade non-matching when search is active or a node is selected.
  function nodeOpacity(node: CanvasNode): number {
    if (hasSearch && !matchedIds.has(node.id)) return 0.18
    if (hasSelection && !neighborIds.has(node.id)) return 0.22
    return 1
  }

  function linkOpacity(link: CanvasLink): number {
    const s = typeof link.source === 'string' ? link.source : (link.source as CanvasNode).id
    const t = typeof link.target === 'string' ? link.target : (link.target as CanvasNode).id
    if (hasSearch) {
      if (matchedIds.has(s) && matchedIds.has(t)) return 0.6
      return 0.08
    }
    if (hasSelection) {
      if (s === selectedId || t === selectedId) return 0.7
      return 0.08
    }
    return 0.4
  }

  useEffect(() => {
    if (!fgRef.current) return
    // Slight delay lets initial layout settle before we frame everything.
    const timer = setTimeout(() => fgRef.current?.zoomToFit(400, 50), 50)
    return () => clearTimeout(timer)
  }, [data])

  return (
    <ForceGraph2D
      ref={fgRef as any}
      graphData={{ nodes, links }}
      width={width}
      height={height}
      backgroundColor={palette.surface}
      nodeId="id"
      nodeRelSize={4}
      nodeLabel={(n: any) => `${n.label} · ${n.type}`}
      cooldownTicks={140}
      d3VelocityDecay={0.35}
      onNodeHover={(n: any) => setHoveredId(n?.id ?? null)}
      onNodeClick={(n: any) => onSelect(n as GraphNode)}
      onBackgroundClick={() => onSelect(null)}
      linkColor={(l: any) => withOpacity(l.__cssColor ?? palette.line, linkOpacity(l))}
      linkWidth={(l: any) => {
        const s = typeof l.source === 'string' ? l.source : l.source.id
        const t = typeof l.target === 'string' ? l.target : l.target.id
        const emphasized = hasSelection && (s === selectedId || t === selectedId)
        return emphasized ? 1.6 : 0.8 + Math.min(l.weight ?? 1, 4) * 0.15
      }}
      nodeCanvasObject={(node: any, ctx: any, globalScale: number) => {
        const n = node as CanvasNode
        const opacity = nodeOpacity(n)
        const radius = Math.max(2.5, Math.sqrt(n.val ?? 1) * 4)
        const isSelected = n.id === selectedId
        const isHovered = n.id === hoveredId

        ctx.beginPath()
        ctx.arc(n.x ?? 0, n.y ?? 0, radius, 0, 2 * Math.PI, false)
        ctx.fillStyle = withOpacity(n.__cssColor ?? palette.ink, opacity)
        ctx.fill()

        if (isSelected || isHovered) {
          ctx.strokeStyle = withOpacity(palette.accent, opacity)
          ctx.lineWidth = 2 / globalScale
          ctx.stroke()
        }

        // Label: only render when zoomed in enough, or always for themes/concepts,
        // or when the node is hovered/selected/matched.
        const shouldLabel =
          isSelected ||
          isHovered ||
          (hasSearch && matchedIds.has(n.id)) ||
          (n.type !== 'item' && globalScale > 0.6) ||
          (n.type === 'item' && globalScale > 1.6)

        if (shouldLabel) {
          const fontSize = Math.max(9, 11 / globalScale)
          ctx.font = `${fontSize}px Geist, system-ui, sans-serif`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          const text = n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label
          const metrics = ctx.measureText(text)
          const padX = 3 / globalScale
          const padY = 2 / globalScale
          const labelX = (n.x ?? 0) + radius + 4 / globalScale
          const labelY = n.y ?? 0
          ctx.fillStyle = withOpacity(palette.surface, opacity * 0.85)
          ctx.fillRect(
            labelX - padX,
            labelY - fontSize / 2 - padY,
            metrics.width + padX * 2,
            fontSize + padY * 2
          )
          ctx.fillStyle = withOpacity(palette.ink, opacity)
          ctx.fillText(text, labelX, labelY)
        }
      }}
      nodeCanvasObjectMode={() => 'replace'}
    />
  )
}

function withOpacity(color: string, opacity: number): string {
  if (opacity >= 1) return color
  // Handles #RGB, #RRGGBB, rgb(), rgba(), and CSS named colors via a canvas.
  const rgb = parseToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity.toFixed(3)})`
}

const RGB_CACHE = new Map<string, [number, number, number] | null>()

function parseToRgb(input: string): [number, number, number] | null {
  if (RGB_CACHE.has(input)) return RGB_CACHE.get(input)!
  let out: [number, number, number] | null = null
  const trimmed = input.trim()
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1)
    if (hex.length === 3) {
      out = [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ]
    } else if (hex.length === 6) {
      out = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
    }
  } else if (trimmed.startsWith('rgb')) {
    const m = trimmed.match(/(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
    if (m) out = [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  RGB_CACHE.set(input, out)
  return out
}
