import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { buildGraphData, type GraphData, type GraphNode, type NodeType } from '@/db/graph'
import { GraphCanvas } from './GraphCanvas'
import { Icons } from './Icons'

interface Props {
  variant: 'panel' | 'fullpage'
  /** Called when the user requests to ask the agent about a node (panel only). */
  onAskAgent?: (node: GraphNode) => void
}

const ALL_TYPES: NodeType[] = ['item', 'theme', 'concept']

export function GraphExplorer({ variant, onAskAgent }: Props) {
  // useLiveQuery returns a number that bumps any time relevant tables change.
  // We use it as a refresh signal for the (async) graph build.
  const stamp = useLiveQuery(async () => {
    const [items, themes, concepts] = await Promise.all([
      db.items.count(), db.themes.count(), db.concepts.count(),
    ])
    return `${items}:${themes}:${concepts}`
  }, [])

  const [data, setData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    buildGraphData().then((d) => {
      if (!cancelled) {
        setData(d)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [stamp])

  const [visible, setVisible] = useState<Set<NodeType>>(new Set(ALL_TYPES))
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedNode = useMemo(
    () => data.nodes.find((n) => n.id === selectedId) ?? null,
    [data, selectedId]
  )

  function toggleType(t: NodeType) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // Measure the canvas container so the force-graph sizes correctly.
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!canvasContainerRef.current) return
    const el = canvasContainerRef.current
    const obs = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    obs.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => obs.disconnect()
  }, [])

  const stats = useMemo(() => {
    const counts = { item: 0, theme: 0, concept: 0 }
    for (const n of data.nodes) counts[n.type]++
    return counts
  }, [data])

  const sidebarVariant = variant === 'fullpage' ? 'side' : 'below'
  const totalNodes = data.nodes.length
  const isEmpty = !loading && totalNodes === 0

  return (
    <div className={variant === 'fullpage' ? 'flex h-full' : 'flex flex-col h-full'}>
      <div className={variant === 'fullpage' ? 'flex-1 flex flex-col min-w-0' : 'flex flex-col flex-1 min-h-0'}>
        <div className="px-3 py-2 border-b border-line bg-surface-1 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {ALL_TYPES.map((t) => (
              <TypeChip
                key={t}
                label={`${labelOf(t)} ${stats[t]}`}
                active={visible.has(t)}
                color={t === 'concept' ? 'var(--accent)' : t === 'theme' ? 'var(--ink-2)' : 'var(--ink-3)'}
                onClick={() => toggleType(t)}
              />
            ))}
          </div>
          <div className="flex-1 min-w-[140px] relative">
            <Icons.search size={12} stroke={2}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Highlight…"
              className="w-full pl-7 pr-2 py-1 text-xs bg-surface-2 border border-line focus:border-line-strong rounded-lg outline-none text-ink placeholder-ink-3"
            />
          </div>
        </div>

        <div ref={canvasContainerRef} className="flex-1 min-h-0 relative bg-surface">
          {isEmpty ? (
            <EmptyState />
          ) : loading ? (
            <div className="flex items-center justify-center h-full text-ink-3 text-xs">Loading graph…</div>
          ) : size.width > 0 && size.height > 0 ? (
            <GraphCanvas
              data={data}
              width={size.width}
              height={size.height}
              visibleTypes={visible}
              search={search}
              selectedId={selectedId}
              onSelect={(n) => setSelectedId(n?.id ?? null)}
            />
          ) : null}
        </div>

        {sidebarVariant === 'below' && selectedNode && (
          <NodeDetail
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            onAskAgent={onAskAgent}
            variant="below"
          />
        )}
      </div>

      {sidebarVariant === 'side' && (
        <aside className="w-[320px] border-l border-line bg-surface-1 flex-shrink-0 overflow-y-auto">
          {selectedNode ? (
            <NodeDetail
              node={selectedNode}
              onClose={() => setSelectedId(null)}
              onAskAgent={onAskAgent}
              variant="side"
            />
          ) : (
            <div className="p-6 text-xs text-ink-3 leading-relaxed">
              <p className="text-ink-2 font-medium mb-2">{totalNodes} node{totalNodes !== 1 ? 's' : ''}</p>
              <p>Click any node to see its connections and pull up its details.</p>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

function labelOf(t: NodeType): string {
  return t === 'item' ? 'Items' : t === 'theme' ? 'Themes' : 'Concepts'
}

function TypeChip({
  label, active, color, onClick,
}: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1.5
        ${active
          ? 'bg-surface-2 border-line-strong text-ink'
          : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'
        }`}
    >
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{ backgroundColor: active ? color : 'transparent', border: active ? '0' : '1px solid var(--line-strong)' }}
      />
      {label}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
      <Icons.graph size={48} stroke={1.4} />
      <p className="text-sm text-ink-2 m-0">Nothing to graph yet</p>
      <p className="text-xs text-ink-3 max-w-[260px] leading-relaxed m-0">
        Capture some items, tag them with themes, or run <strong>Extract concepts</strong> from the panel
        view to populate the graph.
      </p>
    </div>
  )
}

interface DetailProps {
  node: GraphNode
  variant: 'side' | 'below'
  onClose: () => void
  onAskAgent?: (node: GraphNode) => void
}

function NodeDetail({ node, variant, onClose, onAskAgent }: DetailProps) {
  const connections = useLiveQuery(async () => {
    if (node.type === 'theme') {
      const items = await db.items.where('themeIds').equals(node.refId).toArray()
      return { items, label: 'tagged items' }
    }
    if (node.type === 'concept') {
      const items = await db.items.where('conceptIds').equals(node.refId).toArray()
      return { items, label: 'referencing items' }
    }
    // item
    const item = await db.items.get(node.refId)
    if (!item) return { items: [], label: '' }
    const themeIds = item.themeIds ?? []
    const conceptIds = item.conceptIds ?? []
    const [themes, concepts] = await Promise.all([
      themeIds.length ? db.themes.bulkGet(themeIds) : Promise.resolve([]),
      conceptIds.length ? db.concepts.bulkGet(conceptIds) : Promise.resolve([]),
    ])
    return {
      items: [],
      label: '',
      item,
      themes: themes.filter(Boolean),
      concepts: concepts.filter(Boolean),
    } as any
  }, [node.id])

  const wrapperClass = variant === 'side'
    ? 'p-4 space-y-3'
    : 'border-t border-line bg-surface-1 px-3 py-3 space-y-2 max-h-[40%] overflow-y-auto'

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{node.type}</p>
          <p className="text-sm font-medium text-ink truncate">{node.label}</p>
        </div>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink-2 flex-shrink-0"
          aria-label="Close"
        >
          <Icons.close size={14} stroke={2} />
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>{node.degree} connection{node.degree !== 1 ? 's' : ''}</span>
        {onAskAgent && (
          <button
            onClick={() => onAskAgent(node)}
            className="ml-auto text-xs px-2 py-0.5 rounded border border-line hover:border-line-strong hover:text-accent text-ink-2 transition-colors"
          >
            Ask agent
          </button>
        )}
      </div>

      {node.type === 'item' && connections && 'item' in connections && connections.item && (
        <ItemBody item={connections.item} themes={(connections as any).themes ?? []} concepts={(connections as any).concepts ?? []} />
      )}

      {(node.type === 'theme' || node.type === 'concept') && connections && (
        <div className="space-y-1">
          {(connections as any).items?.slice(0, variant === 'side' ? 30 : 8).map((item: any) => (
            <ItemSnippet key={item.id} item={item} />
          ))}
          {((connections as any).items?.length ?? 0) === 0 && (
            <p className="text-xs text-ink-3 italic">No items {(connections as any).label}.</p>
          )}
        </div>
      )}
    </div>
  )
}

function ItemBody({ item, themes, concepts }: { item: any; themes: any[]; concepts: any[] }) {
  const text = (item.rawContent || item.content || '').replace(/\s+/g, ' ').trim()
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-2 whitespace-pre-wrap line-clamp-6">"{text.slice(0, 400)}{text.length > 400 ? '…' : ''}"</p>
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">{item.domain || 'no source'}{item.date ? ` · ${item.date}` : ''}</p>
      {themes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {themes.map((t: any) => (
            <span key={t.id} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: t.color, color: t.color }}>{t.name}</span>
          ))}
        </div>
      )}
      {concepts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {concepts.map((c: any) => (
            <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded-sm border border-accent text-accent">{c.name}</span>
          ))}
        </div>
      )}
      {item.url && (
        <button
          onClick={() => chrome.tabs.create({ url: item.url })}
          className="text-[11px] text-accent hover:opacity-80"
        >
          Open source ↗
        </button>
      )}
    </div>
  )
}

function ItemSnippet({ item }: { item: any }) {
  const text = (item.rawContent || item.content || '').replace(/\s+/g, ' ').trim()
  return (
    <div className="text-xs px-2 py-1.5 rounded-lg bg-surface-2 border border-line">
      <p className="text-ink-2 truncate">"{text.slice(0, 100)}{text.length > 100 ? '…' : ''}"</p>
      <p className="text-[10px] text-ink-3 mt-0.5">{item.domain || '—'}{item.date ? ` · ${item.date}` : ''}</p>
    </div>
  )
}
