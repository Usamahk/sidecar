import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphNode, NodeType } from '@/db/graph'

export interface InsightBubble {
  /** Stable node id, e.g. "insight-12". */
  id: string
  /** Theme + item node ids whose canvas positions form the hull. */
  supportingNodeIds: Set<string>
  /** Display headline shown at the centroid. */
  headline: string
  /** Base colour for fill/stroke (hex). */
  color: string
}

interface Props {
  data: GraphData
  width: number
  height: number
  visibleTypes: Set<NodeType>
  search: string
  selectedId: string | null
  /** Extra accent borders — nodes in the active comparison set. */
  comparedIds?: Set<string>
  /** When set, only nodes in this set stay full-opacity; everything else dims. */
  highlightedIds?: Set<string> | null
  /** Ambient blobs for each approved insight. Always rendered when insights are
   *  visible; selected one is more saturated. */
  insightBubbles?: InsightBubble[]
  /** Which blob (insight id like "insight-N") is currently selected. */
  selectedInsightId?: string | null
  onSelect: (node: GraphNode | null, additive: boolean) => void
  /** Called when the user clicks inside a blob's hull (not on a node). */
  onSelectInsight?: (insightId: string | null) => void
  nodeSizeMul?: number
  labelSizeMul?: number
  showItemLabels?: boolean
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
  comparedIds,
  highlightedIds,
  insightBubbles,
  selectedInsightId,
  onSelect,
  onSelectInsight,
  nodeSizeMul = 1,
  labelSizeMul = 1,
  showItemLabels = false,
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

    const varToColor: Record<string, string> = {
      'var(--ink-2)': palette.ink,
      'var(--ink-3)': palette.ink3,
      'var(--accent)': palette.accent,
      'var(--line)': palette.line,
      'var(--line-strong)': palette.lineStrong,
    }
    for (const n of data.nodes) {
      if (!visibleTypes.has(n.type)) continue
      const resolved = n.color.startsWith('var(')
        ? (varToColor[n.color] ?? palette.ink3)
        : n.color
      const cached = nodeCache.current.get(n.id)
      const merged: CanvasNode = cached
        ? Object.assign(cached, n, { __cssColor: resolved })
        : { ...n, __cssColor: resolved }
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
  const hasHighlightSet = !!highlightedIds && highlightedIds.size > 0

  // Fade non-matching when search is active, a node is selected, or a comparison
  // highlight set is provided (the latter wins when present).
  function nodeOpacity(node: CanvasNode): number {
    if (hasHighlightSet) {
      if (highlightedIds!.has(node.id)) return 1
      if (comparedIds?.has(node.id)) return 1
      return 0.18
    }
    if (hasSearch && !matchedIds.has(node.id)) return 0.18
    if (hasSelection && !neighborIds.has(node.id)) return 0.22
    return 1
  }

  function linkOpacity(link: CanvasLink): number {
    const s = typeof link.source === 'string' ? link.source : (link.source as CanvasNode).id
    const t = typeof link.target === 'string' ? link.target : (link.target as CanvasNode).id
    if (hasHighlightSet) {
      const sLit = highlightedIds!.has(s) || comparedIds?.has(s)
      const tLit = highlightedIds!.has(t) || comparedIds?.has(t)
      if (sLit && tLit) return 0.55
      return 0.06
    }
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

  // Tune d3-force defaults once the ref is live so the layout doesn't collapse
  // connected nodes into a knot or fling isolated ones to infinity. Re-applied
  // whenever the graph data changes (the simulation gets fresh forces on rebuild).
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const linkForce = fg.d3Force('link') as any
    if (linkForce) {
      linkForce.distance((l: CanvasLink) => 55 + Math.min(l.weight ?? 1, 4) * 6)
      linkForce.strength(0.35)
    }
    const chargeForce = fg.d3Force('charge') as any
    if (chargeForce) {
      // Moderate repulsion that falls off past ~280 units — keeps the cluster
      // breathable but stops isolated nodes from being shoved to the edges.
      chargeForce.strength(-95)
      if (typeof chargeForce.distanceMax === 'function') chargeForce.distanceMax(280)
    }
    fg.d3ReheatSimulation?.()
    const timer = setTimeout(() => fg.zoomToFit?.(400, 50), 80)
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
      onNodeClick={(n: any, ev: MouseEvent) => onSelect(n as GraphNode, !!(ev?.metaKey || ev?.ctrlKey || ev?.shiftKey))}
      onBackgroundClick={(ev: MouseEvent) => {
        if (insightBubbles && insightBubbles.length > 0 && onSelectInsight) {
          // Convert screen click to graph coords and test against each blob's hull.
          const fg = fgRef.current as any
          if (fg?.screen2GraphCoords) {
            const rect = (ev.target as HTMLElement)?.getBoundingClientRect?.()
            const sx = ev.clientX - (rect?.left ?? 0)
            const sy = ev.clientY - (rect?.top ?? 0)
            const { x, y } = fg.screen2GraphCoords(sx, sy)
            const hit = findInsightAtPoint(x, y, insightBubbles, nodes)
            if (hit) {
              onSelectInsight(hit)
              return
            }
          }
        }
        // Default: clear selection.
        onSelect(null, false)
        if (onSelectInsight) onSelectInsight(null)
      }}
      onRenderFramePre={(ctx: any) => {
        if (!insightBubbles || insightBubbles.length === 0) return
        // Index nodes for quick lookup of (x,y).
        const nodeXY = new Map<string, [number, number]>()
        for (const n of nodes) {
          if (n.x == null || n.y == null) continue
          nodeXY.set(n.id, [n.x, n.y])
        }
        // Draw non-selected blobs first (so the selected one sits on top).
        for (const b of insightBubbles) {
          if (b.id === selectedInsightId) continue
          const pts = collectBubblePts(b, nodeXY)
          if (pts.length === 0) continue
          drawBubble(ctx, pts, b.color, /* emphasized */ false)
        }
        for (const b of insightBubbles) {
          if (b.id !== selectedInsightId) continue
          const pts = collectBubblePts(b, nodeXY)
          if (pts.length === 0) continue
          drawBubble(ctx, pts, b.color, /* emphasized */ true)
        }
        // Headlines render after blobs so they stay readable.
        for (const b of insightBubbles) {
          const pts = collectBubblePts(b, nodeXY)
          if (pts.length === 0) continue
          drawHeadline(ctx, pts, b.headline, b.color, b.id === selectedInsightId, palette.surface)
        }
      }}
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
        const radius = Math.max(2.5, Math.sqrt(n.val ?? 1) * 4) * nodeSizeMul
        const isSelected = n.id === selectedId
        const isHovered = n.id === hoveredId
        const isCompared = !!comparedIds?.has(n.id)

        ctx.beginPath()
        ctx.arc(n.x ?? 0, n.y ?? 0, radius, 0, 2 * Math.PI, false)
        ctx.fillStyle = withOpacity(n.__cssColor ?? palette.ink, opacity)
        ctx.fill()

        if (isSelected || isHovered || isCompared) {
          ctx.strokeStyle = withOpacity(palette.accent, opacity)
          ctx.lineWidth = (isCompared ? 2.4 : 2) / globalScale
          ctx.stroke()
        }

        // Label rules:
        //  - themes / insights always carry a label when zoomed in past 0.6
        //  - items only get labels when explicitly enabled, or when this node is
        //    individually highlighted (selected / hovered / matched in search)
        const isItem = n.type === 'item'
        const itemLabelAllowed = isSelected || isHovered || isCompared || (hasSearch && matchedIds.has(n.id)) || showItemLabels
        const shouldLabel =
          isSelected ||
          isHovered ||
          isCompared ||
          (hasSearch && matchedIds.has(n.id)) ||
          (!isItem && globalScale > 0.6) ||
          (isItem && itemLabelAllowed && globalScale > 1.0)

        if (shouldLabel) {
          const fontSize = Math.max(9, 11 / globalScale) * labelSizeMul
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


// ─── Bubble drawing for insight selection ─────────────────────────────────────

const BUBBLE_PADDING = 32   // world-space px, inflates hull outward from centroid

// Two visual presets: faded ambient (every insight) and saturated (selected).
const FILL_AMBIENT = 0.07
const STROKE_AMBIENT = 0.35
const FILL_EMPHASIZED = 0.18
const STROKE_EMPHASIZED = 0.7

export function collectBubblePts(
  bubble: InsightBubble,
  nodeXY: Map<string, [number, number]>
): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (const id of bubble.supportingNodeIds) {
    const xy = nodeXY.get(id)
    if (xy) pts.push(xy)
  }
  return pts
}

function drawBubble(
  ctx: any,
  points: Array<[number, number]>,
  accent: string,
  emphasized: boolean,
) {
  const rgb = parseToRgb(accent)
  const fillAlpha = emphasized ? FILL_EMPHASIZED : FILL_AMBIENT
  const strokeAlpha = emphasized ? STROKE_EMPHASIZED : STROKE_AMBIENT
  const fill = rgb
    ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillAlpha})`
    : accent
  const stroke = rgb
    ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${strokeAlpha})`
    : accent

  if (points.length === 1) {
    const [x, y] = points[0]
    ctx.beginPath()
    ctx.arc(x, y, BUBBLE_PADDING, 0, 2 * Math.PI, false)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = emphasized ? 1.6 : 1
    ctx.stroke()
    return
  }
  if (points.length === 2) {
    const [a, b] = points
    const cx = (a[0] + b[0]) / 2
    const cy = (a[1] + b[1]) / 2
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    const r = len / 2 + BUBBLE_PADDING
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI, false)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = emphasized ? 1.6 : 1
    ctx.stroke()
    return
  }

  const hull = convexHull(points)
  if (hull.length < 3) return
  const inflated = inflateHull(hull, BUBBLE_PADDING)
  drawSmoothClosed(ctx, inflated)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = emphasized ? 1.6 : 1
  ctx.stroke()
}

function drawHeadline(
  ctx: any,
  points: Array<[number, number]>,
  headline: string,
  color: string,
  emphasized: boolean,
  surface: string,
) {
  if (points.length === 0) return
  let cx = 0, cy = 0
  for (const [x, y] of points) { cx += x; cy += y }
  cx /= points.length
  cy /= points.length

  const text = headline.length > 36 ? headline.slice(0, 35) + '…' : headline
  const fontSize = emphasized ? 12 : 10
  ctx.font = `${emphasized ? 600 : 500} ${fontSize}px Geist, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const metrics = ctx.measureText(text)
  const padX = 6
  const padY = 3
  const w = metrics.width + padX * 2
  const h = fontSize + padY * 2

  // Pill background — uses the surface color so labels remain readable over
  // overlapping blobs.
  const rgb = parseToRgb(surface)
  ctx.fillStyle = rgb
    ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${emphasized ? 0.95 : 0.82})`
    : surface
  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(cx - w / 2 + r, cy - h / 2)
  ctx.lineTo(cx + w / 2 - r, cy - h / 2)
  ctx.arc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(cx - w / 2 + r, cy + h / 2)
  ctx.arc(cx - w / 2 + r, cy, r, Math.PI / 2, 3 * Math.PI / 2)
  ctx.closePath()
  ctx.fill()
  const stroke = parseToRgb(color)
  ctx.strokeStyle = stroke
    ? `rgba(${stroke[0]}, ${stroke[1]}, ${stroke[2]}, ${emphasized ? 0.9 : 0.5})`
    : color
  ctx.lineWidth = emphasized ? 1 : 0.7
  ctx.stroke()

  ctx.fillStyle = color
  ctx.fillText(text, cx, cy)
}

// Locate the smallest blob whose hull contains (x, y). Smaller = "on top" when
// blobs overlap.
export function findInsightAtPoint(
  x: number,
  y: number,
  bubbles: InsightBubble[],
  nodes: Array<{ id: string; x?: number; y?: number }>,
): string | null {
  const nodeXY = new Map<string, [number, number]>()
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue
    nodeXY.set(n.id, [n.x, n.y])
  }
  let bestId: string | null = null
  let bestArea = Infinity
  for (const b of bubbles) {
    const pts = collectBubblePts(b, nodeXY)
    if (pts.length === 0) continue
    let polygon: Array<[number, number]>
    if (pts.length === 1) {
      // Approximate as a circle → 16-sided polygon for hit-test.
      polygon = circlePolygon(pts[0], BUBBLE_PADDING)
    } else if (pts.length === 2) {
      const [a, c] = pts
      const cx = (a[0] + c[0]) / 2
      const cy = (a[1] + c[1]) / 2
      const r = Math.hypot(c[0] - a[0], c[1] - a[1]) / 2 + BUBBLE_PADDING
      polygon = circlePolygon([cx, cy], r)
    } else {
      const hull = convexHull(pts)
      polygon = inflateHull(hull, BUBBLE_PADDING)
    }
    if (!pointInPolygon(x, y, polygon)) continue
    const area = polygonArea(polygon)
    if (area < bestArea) {
      bestArea = area
      bestId = b.id
    }
  }
  return bestId
}

function circlePolygon([cx, cy]: [number, number], r: number): Array<[number, number]> {
  const N = 16
  const out: Array<[number, number]> = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r])
  }
  return out
}

function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function polygonArea(poly: Array<[number, number]>): number {
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1])
  }
  return Math.abs(s) / 2
}

// Andrew's monotone chain — returns hull points in counter-clockwise order.
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const points = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])
  const lower: Array<[number, number]> = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function inflateHull(hull: Array<[number, number]>, padding: number): Array<[number, number]> {
  let cx = 0, cy = 0
  for (const [x, y] of hull) { cx += x; cy += y }
  cx /= hull.length
  cy /= hull.length
  return hull.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const len = Math.hypot(dx, dy) || 1
    const k = (len + padding) / len
    return [cx + dx * k, cy + dy * k] as [number, number]
  })
}

// Closed Catmull-Rom-style smoothing — connects consecutive hull points with
// short cubic curves so the bubble feels blobby rather than polygonal.
function drawSmoothClosed(ctx: any, pts: Array<[number, number]>) {
  if (pts.length < 3) return
  ctx.beginPath()
  const n = pts.length
  const start: [number, number] = [
    (pts[n - 1][0] + pts[0][0]) / 2,
    (pts[n - 1][1] + pts[0][1]) / 2,
  ]
  ctx.moveTo(start[0], start[1])
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n]
    const mid: [number, number] = [(pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2]
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mid[0], mid[1])
  }
  ctx.closePath()
}
