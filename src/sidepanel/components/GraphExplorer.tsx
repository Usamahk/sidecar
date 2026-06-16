import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { db } from '@/db/schema'
import { buildGraphData, type GraphData, type GraphNode, type NodeType } from '@/db/graph'
import { GraphCanvas, type InsightBubble } from './GraphCanvas'
import { InsightsList } from './InsightsList'
import { Icons } from './Icons'
import { usePopoutPresence } from '@/sidepanel/state/graphPopout'

// Soft palette for ambient insight blobs. Cycled by insight id so each blob is
// visually distinct from its neighbours.
const BLOB_PALETTE = [
  '#E0604F', // coral (matches accent)
  '#7E8B5C', // moss
  '#8E6CC4', // lavender
  '#3F8FB3', // teal
  '#C2873E', // amber
  '#A85B7C', // mauve
  '#5B9D7F', // sage
  '#B95E94', // berry
]

function blobColorFor(insightId: number): string {
  return BLOB_PALETTE[insightId % BLOB_PALETTE.length]
}

interface Props {
  variant: 'panel' | 'fullpage'
}

const NODE_TYPES: NodeType[] = ['item', 'theme']
// The "Insights" type chip controls blob rendering even though insights aren't
// graph nodes — it sits alongside the real node-type toggles in the top bar.
type FilterType = NodeType | 'insight'
const FILTER_TYPES: FilterType[] = ['item', 'theme', 'insight']

export interface ViewSettings {
  nodeSizeMul: number
  labelSizeMul: number
  showItemLabels: boolean
}

const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  nodeSizeMul: 1,
  labelSizeMul: 1,
  showItemLabels: false,
}

export function GraphExplorer({ variant }: Props) {
  const stamp = useLiveQuery(async () => {
    const [items, themes, insights] = await Promise.all([
      db.items.count(), db.themes.count(), db.insights.count(),
    ])
    return `${items}:${themes}:${insights}`
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

  const [visible, setVisible] = useState<Set<FilterType>>(new Set(FILTER_TYPES))
  const visibleNodeTypes = useMemo(() => {
    const out = new Set<NodeType>()
    for (const t of NODE_TYPES) if (visible.has(t)) out.add(t)
    return out
  }, [visible])
  const insightsVisible = visible.has('insight')
  const [search, setSearch] = useState('')
  const [viewSettings, setViewSettings] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS)

  // Unified nav stack. Each entry is an id like 'theme-N', 'item-N', or 'insight-N'.
  // The top of the stack is the current selection. Drilling pushes; Back pops.
  const [navStack, setNavStack] = useState<string[]>([])
  // Comparison set — Cmd/Ctrl/Shift-click on canvas nodes builds this up.
  const [compareSet, setCompareSet] = useState<string[]>([])
  const [compareOp, setCompareOp] = useState<CompareOp>('intersection')

  const compareMode = compareSet.length >= 2
  // The "top selection" drives the sidebar; in compare-staging (1 in compareSet
  // and nothing on navStack), surface that as the selection so the detail
  // panel renders something useful.
  const topSelection: string | null = compareMode
    ? null
    : (navStack[navStack.length - 1] ?? (compareSet.length === 1 ? compareSet[0] : null))

  const selectedKind: 'theme' | 'item' | 'insight' | null = topSelection
    ? (topSelection.startsWith('theme-') ? 'theme'
      : topSelection.startsWith('item-') ? 'item'
      : topSelection.startsWith('insight-') ? 'insight'
      : null)
    : null

  // Node selection (for canvas highlight + dim) is only set when a theme or
  // item is on top. Insights drive blob emphasis instead.
  const selectedNodeId = (selectedKind === 'theme' || selectedKind === 'item') ? topSelection : null
  const selectedInsightId = selectedKind === 'insight' ? topSelection : null

  const canGoBack = !compareMode && navStack.length > 1

  const compareNodes = useMemo(() => {
    return compareSet
      .map((id) => data.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => !!n)
  }, [data, compareSet])

  function toggleType(t: FilterType) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function handleCanvasSelect(id: string | null, additive: boolean) {
    if (id == null) {
      setNavStack([])
      setCompareSet([])
      return
    }
    if (additive) {
      setCompareSet((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id)
        return [...prev, id]
      })
      setCompareSet((prev) => {
        if (prev.length === 1 && navStack.length > 0) {
          const prior = navStack[navStack.length - 1]
          if (prior !== prev[0]) return [prior, ...prev]
        }
        return prev
      })
    } else {
      setCompareSet([])
      setNavStack([id])
    }
  }

  function handleSelectInsight(id: string | null) {
    if (id == null) {
      setNavStack([])
      setCompareSet([])
      return
    }
    setCompareSet([])
    setNavStack([id])
  }

  function selectItemFromList(itemId: number) {
    setVisible((prev) => {
      if (prev.has('item')) return prev
      const next = new Set(prev)
      next.add('item')
      return next
    })
    // Drilling into an item pushes onto the stack so Back returns to wherever
    // we came from (a theme list, an insight detail, etc.).
    if (compareMode) {
      setCompareSet([])
      setNavStack([`item-${itemId}`])
    } else {
      setNavStack((s) => [...s, `item-${itemId}`])
    }
  }

  function goBack() {
    setNavStack((s) => s.slice(0, -1))
  }

  function clearSelection() {
    setNavStack([])
    setCompareSet([])
  }

  function removeFromCompare(id: string) {
    setCompareSet((prev) => prev.filter((x) => x !== id))
  }

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

  const insightCount = useLiveQuery(() => db.insights.count(), []) ?? 0

  const stats = useMemo(() => {
    const counts: Record<FilterType, number> = { item: 0, theme: 0, insight: 0 }
    for (const n of data.nodes) {
      if (n.type === 'item' || n.type === 'theme') counts[n.type]++
    }
    counts.insight = insightCount
    return counts
  }, [data, insightCount])

  // Resolve each compared node to its set of item-ids; recompute when the set
  // or the underlying items change.
  const memberSets = useLiveQuery(
    async () => {
      if (compareSet.length === 0) return [] as MemberSet[]
      const out: MemberSet[] = []
      for (const nodeId of compareSet) {
        const sep = nodeId.indexOf('-')
        const type = nodeId.slice(0, sep)
        const refId = Number(nodeId.slice(sep + 1))
        if (type === 'theme') {
          const ids = await db.items
            .where('themeIds').equals(refId)
            .primaryKeys() as number[]
          out.push({ nodeId, ids: new Set(ids) })
        } else if (type === 'insight') {
          const insight = await db.insights.get(refId)
          out.push({ nodeId, ids: new Set(insight?.itemIds ?? []) })
        } else {
          out.push({ nodeId, ids: new Set([refId]) })
        }
      }
      return out
    },
    [compareSet.join('|')]
  ) ?? []

  const compareResultIds = useMemo(
    () => compareMode ? computeOp(memberSets, compareOp) : new Set<number>(),
    [memberSets, compareOp, compareMode]
  )

  // Highlight set: in compare mode it's the result item nodes + the operands;
  // in insight-selection mode it's the supporting nodes of the selected insight.
  // The canvas dims everything outside this set.
  const highlightedIds = useMemo(() => {
    if (compareMode) {
      const set = new Set<string>()
      for (const id of compareResultIds) set.add(`item-${id}`)
      for (const nid of compareSet) set.add(nid)
      return set
    }
    return null
  }, [compareMode, compareResultIds, compareSet])

  const comparedIds = useMemo(() => new Set(compareSet), [compareSet])

  // Build the bubble set for every approved insight. The canvas always renders
  // these (faded) and emphasizes the selected one. Suppressed in compare mode
  // and when the user has hidden Insights via the type-filter chip.
  const insightBubbles = useLiveQuery<InsightBubble[]>(
    async () => {
      if (compareMode || !insightsVisible) return [] as InsightBubble[]
      const all = await db.insights.toArray()
      return all
        .filter((i: any) => i.id != null)
        .map((i: any) => {
          const ids = new Set<string>()
          for (const tId of i.themeIds) ids.add(`theme-${tId}`)
          for (const itemId of i.itemIds) ids.add(`item-${itemId}`)
          return {
            id: `insight-${i.id}`,
            supportingNodeIds: ids,
            headline: i.headline,
            color: blobColorFor(i.id!),
          }
        })
    },
    [compareMode, insightsVisible]
  ) ?? []

  // When an insight is selected, build a highlight set from its supporting
  // nodes so the canvas fades everything else.
  const insightHighlightIds = useMemo(() => {
    if (compareMode || !selectedInsightId) return null
    const bubble = insightBubbles.find((b) => b.id === selectedInsightId)
    if (!bubble) return null
    return bubble.supportingNodeIds
  }, [compareMode, selectedInsightId, insightBubbles])

  const effectiveHighlightedIds = highlightedIds ?? insightHighlightIds

  const popoutOpen = usePopoutPresence()
  const shouldShowCanvas = variant === 'fullpage' || !popoutOpen
  const sidebarVariant = variant === 'fullpage' ? 'side' : 'below'
  const totalNodes = data.nodes.length
  const isEmpty = !loading && totalNodes === 0

  return (
    <div className={variant === 'fullpage' ? 'flex h-full' : 'flex flex-col h-full'}>
      <div className={variant === 'fullpage' ? 'flex-1 flex flex-col min-w-0' : 'flex flex-col flex-1 min-h-0'}>
        <div className="px-3 py-2 border-b border-line bg-surface-1 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            {FILTER_TYPES.map((t) => (
              <TypeChip
                key={t}
                label={`${labelOf(t)} ${stats[t]}`}
                active={visible.has(t)}
                color={t === 'insight' ? 'var(--accent)' : t === 'theme' ? 'var(--ink-2)' : 'var(--ink-3)'}
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
          <ViewSettingsButton settings={viewSettings} onChange={setViewSettings} />
        </div>

        <div ref={canvasContainerRef} className="flex-1 min-h-0 relative bg-surface">
          {!shouldShowCanvas ? (
            <PopoutPlaceholder />
          ) : isEmpty ? (
            <EmptyState />
          ) : loading ? (
            <div className="flex items-center justify-center h-full text-ink-3 text-xs">Loading graph…</div>
          ) : size.width > 0 && size.height > 0 ? (
            <GraphCanvas
              data={data}
              width={size.width}
              height={size.height}
              visibleTypes={visibleNodeTypes}
              search={search}
              selectedId={selectedNodeId}
              comparedIds={comparedIds}
              highlightedIds={effectiveHighlightedIds}
              insightBubbles={insightBubbles}
              selectedInsightId={selectedInsightId}
              onSelectInsight={handleSelectInsight}
              onSelect={(n, additive) => handleCanvasSelect(n?.id ?? null, additive)}
              nodeSizeMul={viewSettings.nodeSizeMul}
              labelSizeMul={viewSettings.labelSizeMul}
              showItemLabels={viewSettings.showItemLabels}
            />
          ) : null}
        </div>

        {sidebarVariant === 'below' && (
          <SidebarBody
            compareMode={compareMode}
            compareNodes={compareNodes}
            compareOp={compareOp}
            setCompareOp={setCompareOp}
            compareResultIds={compareResultIds}
            removeFromCompare={removeFromCompare}
            clearSelection={clearSelection}
            selectItemFromList={selectItemFromList}
            selectedKind={selectedKind}
            selectedNodeId={selectedNodeId}
            selectedInsightId={selectedInsightId}
            canGoBack={canGoBack}
            goBack={goBack}
            handleSelectInsight={handleSelectInsight}
            variant="below"
          />
        )}
      </div>

      {sidebarVariant === 'side' && (
        <aside className="w-[340px] border-l border-line bg-surface-1 flex-shrink-0 flex flex-col">
          <SidebarBody
            compareMode={compareMode}
            compareNodes={compareNodes}
            compareOp={compareOp}
            setCompareOp={setCompareOp}
            compareResultIds={compareResultIds}
            removeFromCompare={removeFromCompare}
            clearSelection={clearSelection}
            selectItemFromList={selectItemFromList}
            selectedKind={selectedKind}
            selectedNodeId={selectedNodeId}
            selectedInsightId={selectedInsightId}
            canGoBack={canGoBack}
            goBack={goBack}
            handleSelectInsight={handleSelectInsight}
            variant="side"
          />
        </aside>
      )}
    </div>
  )
}

function PopoutPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
      <Icons.link size={32} stroke={1.4} />
      <p className="text-sm text-ink-2 m-0">View graph in pop-out</p>
      <p className="text-xs text-ink-3 max-w-[240px] leading-relaxed m-0">
        The graph is open in a separate tab. Close that tab to bring the canvas back here.
      </p>
    </div>
  )
}

interface SidebarBodyProps {
  variant: 'side' | 'below'
  compareMode: boolean
  compareNodes: GraphNode[]
  compareOp: CompareOp
  setCompareOp: (op: CompareOp) => void
  compareResultIds: Set<number>
  removeFromCompare: (id: string) => void
  clearSelection: () => void
  selectItemFromList: (itemId: number) => void
  selectedKind: 'theme' | 'item' | 'insight' | null
  selectedNodeId: string | null
  selectedInsightId: string | null
  canGoBack: boolean
  goBack: () => void
  handleSelectInsight: (id: string | null) => void
}

function SidebarBody({
  variant,
  compareMode,
  compareNodes,
  compareOp,
  setCompareOp,
  compareResultIds,
  removeFromCompare,
  clearSelection,
  selectItemFromList,
  selectedKind,
  selectedNodeId,
  selectedInsightId,
  canGoBack,
  goBack,
  handleSelectInsight,
}: SidebarBodyProps) {
  if (compareMode) {
    const wrapperClass = variant === 'side'
      ? 'flex-1 overflow-y-auto'
      : 'border-t border-line bg-surface-1'
    return (
      <div className={wrapperClass}>
        <ComparePanel
          nodes={compareNodes}
          op={compareOp}
          onChangeOp={setCompareOp}
          resultIds={compareResultIds}
          onRemove={removeFromCompare}
          onClose={clearSelection}
          onSelectItem={selectItemFromList}
          variant={variant}
        />
      </div>
    )
  }

  // Detail at the top, insights list below. Same layout for both variants —
  // only the chrome around it (border-top vs border-left) differs.
  const detailContainerClass = variant === 'side'
    ? 'border-b border-line max-h-[55%] overflow-y-auto flex-shrink-0'
    : 'border-t border-line bg-surface-1 max-h-[55%] overflow-y-auto flex-shrink-0'
  const listContainerClass = variant === 'side'
    ? 'flex-1 overflow-y-auto'
    : 'border-t border-line bg-surface-1 max-h-[45%] overflow-y-auto'

  let detail: React.ReactNode = null
  if (selectedKind === 'insight' && selectedInsightId) {
    detail = (
      <InsightDetail
        insightId={selectedInsightId}
        colorFor={blobColorFor}
        onClose={() => handleSelectInsight(null)}
        onBack={canGoBack ? goBack : undefined}
        onSelectItem={selectItemFromList}
        variant={variant}
      />
    )
  } else if ((selectedKind === 'theme' || selectedKind === 'item') && selectedNodeId) {
    detail = (
      <NodeDetail
        nodeId={selectedNodeId}
        onClose={clearSelection}
        onBack={canGoBack ? goBack : undefined}
        onSelectItem={selectItemFromList}
        variant={variant}
      />
    )
  }

  return (
    <>
      {detail && <div className={detailContainerClass}>{detail}</div>}
      {!detail && (
        <div className={listContainerClass}>
          <InsightsList
            selectedInsightId={selectedInsightId}
            onSelect={handleSelectInsight}
            colorFor={blobColorFor}
            variant={variant === 'side' ? 'fullpage' : 'panel'}
          />
        </div>
      )}
      {detail && variant === 'side' && (
        <div className="flex-1 overflow-y-auto">
          <InsightsList
            selectedInsightId={selectedInsightId}
            onSelect={handleSelectInsight}
            colorFor={blobColorFor}
            variant="fullpage"
          />
        </div>
      )}
    </>
  )
}

function labelOf(t: FilterType): string {
  return t === 'item' ? 'Items' : t === 'theme' ? 'Themes' : 'Insights'
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

function ViewSettingsButton({
  settings, onChange,
}: { settings: ViewSettings; onChange: (next: ViewSettings) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-[11px] px-2 py-1 rounded-full border transition-colors flex items-center gap-1
          ${open
            ? 'bg-surface-2 border-line-strong text-ink'
            : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'
          }`}
        aria-label="View settings"
        title="View settings"
      >
        <Icons.settings size={12} stroke={2} />
        View
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[220px] bg-surface-1 border border-line-strong rounded-lg shadow-lg p-3 space-y-3">
          <SliderRow
            label="Node size"
            value={settings.nodeSizeMul}
            onChange={(v) => onChange({ ...settings, nodeSizeMul: v })}
          />
          <SliderRow
            label="Label size"
            value={settings.labelSizeMul}
            onChange={(v) => onChange({ ...settings, labelSizeMul: v })}
          />
          <label className="flex items-center justify-between gap-2 text-xs text-ink-2">
            <span>Show item labels</span>
            <button
              onClick={() => onChange({ ...settings, showItemLabels: !settings.showItemLabels })}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                ${settings.showItemLabels
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'border-line text-ink-3 hover:border-line-strong'
                }`}
            >
              {settings.showItemLabels ? 'ON' : 'OFF'}
            </button>
          </label>
          <button
            onClick={() => onChange(DEFAULT_VIEW_SETTINGS)}
            className="text-[10px] text-ink-3 hover:text-ink-2 underline"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

function SliderRow({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-ink-2">{label}</span>
        <span className="text-[10px] font-mono tabular-nums text-ink-3">{value.toFixed(1)}×</span>
      </div>
      <input
        type="range"
        min={0.5}
        max={2.5}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
      <Icons.graph size={48} stroke={1.4} />
      <p className="text-sm text-ink-2 m-0">Nothing to graph yet</p>
      <p className="text-xs text-ink-3 max-w-[260px] leading-relaxed m-0">
        Capture some items, tag them with themes, or run <strong>Surface insights</strong> from the panel
        view to populate the graph.
      </p>
    </div>
  )
}


function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-accent transition-colors -ml-0.5"
      aria-label="Back to previous selection"
    >
      <Icons.chevron size={11} stroke={2} style={{ transform: 'rotate(180deg)' }} />
      Back
    </button>
  )
}

interface NodeDetailProps {
  nodeId: string
  variant: 'side' | 'below'
  onClose: () => void
  onBack?: () => void
  onSelectItem: (itemId: number) => void
}

function NodeDetail({ nodeId, variant, onClose, onBack, onSelectItem }: NodeDetailProps) {
  const sep = nodeId.indexOf('-')
  const type = nodeId.slice(0, sep) as 'theme' | 'item'
  const refId = Number(nodeId.slice(sep + 1))

  const wrapperClass = variant === 'side' ? 'p-4 space-y-3' : 'px-3 py-3 space-y-2'

  if (type === 'theme') {
    return (
      <ThemeDetail
        themeId={refId}
        wrapperClass={wrapperClass}
        onClose={onClose}
        onBack={onBack}
        onSelectItem={onSelectItem}
        variant={variant}
      />
    )
  }
  return (
    <ItemDetail
      itemId={refId}
      wrapperClass={wrapperClass}
      onClose={onClose}
      onBack={onBack}
      variant={variant}
    />
  )
}

function ThemeDetail({
  themeId, wrapperClass, onClose, onBack, onSelectItem, variant,
}: {
  themeId: number
  wrapperClass: string
  onClose: () => void
  onBack?: () => void
  onSelectItem: (id: number) => void
  variant: 'side' | 'below'
}) {
  const data = useLiveQuery(async () => {
    const [theme, items] = await Promise.all([
      db.themes.get(themeId),
      db.items.where('themeIds').equals(themeId).reverse().sortBy('createdAt'),
    ])
    return { theme, items }
  }, [themeId])

  if (!data || !data.theme) {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-ink-3 italic">Loading…</p>
      </div>
    )
  }

  const theme = data.theme
  const items = data.items
  return (
    <div className={wrapperClass}>
      {onBack && <BackRow onBack={onBack} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <span
            className="mt-1 w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: theme.color }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">theme</p>
            <p className="text-sm font-medium text-ink truncate">{theme.name}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink-2 flex-shrink-0"
          aria-label="Close"
        >
          <Icons.close size={14} stroke={2} />
        </button>
      </div>
      {theme.description && (
        <p className="text-xs text-ink-3 italic">{theme.description}</p>
      )}
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
        {items.length} item{items.length !== 1 ? 's' : ''}
      </p>
      <div className="space-y-1">
        {items.slice(0, variant === 'side' ? 40 : 12).map((item: any) => (
          <ItemSnippet key={item.id} item={item} onOpen={() => onSelectItem(item.id)} />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-ink-3 italic">No items tagged with this theme yet.</p>
        )}
      </div>
    </div>
  )
}

function ItemDetail({
  itemId, wrapperClass, onClose, onBack, variant,
}: {
  itemId: number
  wrapperClass: string
  onClose: () => void
  onBack?: () => void
  variant: 'side' | 'below'
}) {
  void variant
  const data = useLiveQuery(async () => {
    const item = await db.items.get(itemId)
    if (!item) return null
    const [themes, insights] = await Promise.all([
      item.themeIds.length ? db.themes.bulkGet(item.themeIds) : Promise.resolve([]),
      db.insights.toArray(),
    ])
    return {
      item,
      themes: themes.filter(Boolean),
      referencing: insights.filter((i: any) => i.itemIds.includes(itemId)),
    }
  }, [itemId])

  if (!data || !data.item) {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-ink-3 italic">Loading…</p>
      </div>
    )
  }

  const item = data.item
  const content = (item.content || item.rawContent || '').trim()

  return (
    <div className={wrapperClass}>
      {onBack && <BackRow onBack={onBack} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">item</p>
          <p className="text-sm font-medium text-ink truncate">
            {item.pageTitle || item.domain || `Item ${item.id}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink-2 flex-shrink-0"
          aria-label="Close"
        >
          <Icons.close size={14} stroke={2} />
        </button>
      </div>

      {content ? (
        <div className="font-sans text-[13px] text-ink leading-relaxed
          [&>p]:my-1.5
          [&>h1]:text-base [&>h1]:font-semibold [&>h1]:mt-3 [&>h1]:mb-1.5 [&>h1]:text-ink
          [&>h2]:text-[15px] [&>h2]:font-semibold [&>h2]:mt-3 [&>h2]:mb-1.5 [&>h2]:text-ink
          [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-2 [&>h3]:mb-1 [&>h3]:text-ink
          [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:my-1.5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:my-1.5
          [&>li]:my-0.5
          [&>blockquote]:border-l-2 [&>blockquote]:border-accent [&>blockquote]:pl-3 [&>blockquote]:my-2 [&>blockquote]:text-ink-2 [&>blockquote]:italic
          [&_code]:text-accent [&_code]:font-mono [&_code]:text-[12px] [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
          [&_strong]:text-ink [&_strong]:font-semibold
          [&_em]:italic
          [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-accent/40
          [&_hr]:my-3 [&_hr]:border-line">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => { e.preventDefault(); if (href) chrome.tabs.create({ url: href }) }}
                  className="text-accent underline cursor-pointer hover:opacity-80"
                >
                  {children}
                </a>
              ),
            }}
          >{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-ink-3 italic">(no content)</p>
      )}

      {item.notes && (
        <div className="text-[12px] text-ink-2 border-l-2 border-line-strong pl-3 py-1 leading-relaxed">
          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mr-1 block mb-0.5">notes</span>
          {item.notes}
        </div>
      )}

      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
        {item.domain || 'no source'}{item.date ? ` · ${item.date}` : ''}
      </p>

      {data.themes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.themes.map((t: any) => (
            <span key={t.id} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: t.color, color: t.color }}>
              {t.name}
            </span>
          ))}
        </div>
      )}

      {data.referencing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
            Referenced by insight{data.referencing.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-1">
            {data.referencing.map((i: any) => (
              <span key={i.id} className="text-[10px] px-1.5 py-0.5 rounded-sm border border-accent text-accent">
                {i.headline}
              </span>
            ))}
          </div>
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

interface InsightDetailProps {
  insightId: string
  variant: 'side' | 'below'
  colorFor: (id: number) => string
  onClose: () => void
  onBack?: () => void
  onSelectItem: (itemId: number) => void
}

function InsightDetail({ insightId, variant, colorFor, onClose, onBack, onSelectItem }: InsightDetailProps) {
  const refId = Number(insightId.slice('insight-'.length))

  const data = useLiveQuery(async () => {
    const insight = await db.insights.get(refId)
    if (!insight) return null
    const [themes, items] = await Promise.all([
      insight.themeIds.length ? db.themes.bulkGet(insight.themeIds) : Promise.resolve([]),
      insight.itemIds.length ? db.items.bulkGet(insight.itemIds) : Promise.resolve([]),
    ])
    return {
      insight,
      themes: themes.filter(Boolean),
      items: items.filter(Boolean),
    }
  }, [refId])

  const wrapperClass = variant === 'side' ? 'p-4 space-y-3' : 'px-3 py-3 space-y-2'

  if (!data) {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-ink-3 italic">Loading insight…</p>
      </div>
    )
  }

  const color = colorFor(refId)

  return (
    <div className={wrapperClass}>
      {onBack && <BackRow onBack={onBack} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <span
            className="mt-1 w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">insight</p>
            <p className="text-sm font-medium text-ink leading-snug">{data.insight.headline}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink-2 flex-shrink-0"
          aria-label="Close"
        >
          <Icons.close size={14} stroke={2} />
        </button>
      </div>

      <InsightBody
        insight={data.insight}
        themes={data.themes}
        items={data.items}
        onSelectItem={onSelectItem}
        variant={variant}
      />
    </div>
  )
}

function InsightBody({
  insight, themes, items, onSelectItem, variant,
}: {
  insight: any
  themes: any[]
  items: any[]
  onSelectItem: (id: number) => void
  variant: 'side' | 'below'
}) {
  const strength = insight.strength ?? 0
  const strengthLabel = strength >= 0.7 ? 'strong' : strength >= 0.4 ? 'medium' : 'weak'
  const generated = insight.generatedAt ? new Date(insight.generatedAt) : null

  return (
    <div className="space-y-3">
      {insight.rationale && (
        <p className="text-[13px] text-ink-2 italic leading-relaxed border-l-2 border-accent pl-3">
          {insight.rationale}
        </p>
      )}

      <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-ink-3">
        <span title={`strength ${(strength * 100).toFixed(0)}%`}>strength: {strengthLabel}</span>
        {generated && <span title={generated.toISOString()}>· surfaced {formatAgo(generated.getTime())}</span>}
      </div>

      {themes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Themes</p>
          <div className="flex flex-wrap gap-1">
            {themes.map((t: any) => (
              <span
                key={t.id}
                className="text-[11px] px-2 py-0.5 rounded-full border"
                style={{ borderColor: t.color, color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
          Grounding items ({items.length})
        </p>
        {items.slice(0, variant === 'side' ? 40 : 8).map((item: any) => (
          <ItemSnippet key={item.id} item={item} onOpen={() => onSelectItem(item.id)} />
        ))}
      </div>
    </div>
  )
}

function formatAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ---------- Compare-mode types & helpers ----------

export type CompareOp =
  | 'union'
  | 'intersection'
  | 'symmetric'      // in exactly one
  | { onlyIn: string }  // in this node id, in none of the others

interface MemberSet {
  nodeId: string
  ids: Set<number>
}

function computeOp(sets: MemberSet[], op: CompareOp): Set<number> {
  if (sets.length === 0) return new Set()
  if (op === 'union') {
    const out = new Set<number>()
    for (const s of sets) for (const id of s.ids) out.add(id)
    return out
  }
  if (op === 'intersection') {
    const sorted = [...sets].sort((a, b) => a.ids.size - b.ids.size)
    let out = new Set(sorted[0].ids)
    for (let i = 1; i < sorted.length; i++) {
      const next = new Set<number>()
      for (const id of out) if (sorted[i].ids.has(id)) next.add(id)
      out = next
    }
    return out
  }
  if (op === 'symmetric') {
    const counts = new Map<number, number>()
    for (const s of sets) {
      for (const id of s.ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    const out = new Set<number>()
    for (const [id, n] of counts) if (n === 1) out.add(id)
    return out
  }
  // onlyIn: items in the named set but in none of the others
  const target = sets.find((s) => s.nodeId === op.onlyIn)
  if (!target) return new Set()
  const others = sets.filter((s) => s.nodeId !== op.onlyIn)
  const otherUnion = new Set<number>()
  for (const s of others) for (const id of s.ids) otherUnion.add(id)
  const out = new Set<number>()
  for (const id of target.ids) if (!otherUnion.has(id)) out.add(id)
  return out
}

function opLabel(op: CompareOp, nodes: GraphNode[]): string {
  if (op === 'union') return 'Union'
  if (op === 'intersection') return 'Intersection'
  if (op === 'symmetric') return 'In exactly one'
  const node = nodes.find((n) => n.id === op.onlyIn)
  return node ? `Only in ${node.label}` : 'Only in (removed)'
}

interface ComparePanelProps {
  nodes: GraphNode[]
  op: CompareOp
  onChangeOp: (op: CompareOp) => void
  resultIds: Set<number>
  onRemove: (nodeId: string) => void
  onClose: () => void
  onSelectItem: (itemId: number) => void
  variant: 'side' | 'below'
}

function ComparePanel({
  nodes, op, onChangeOp, resultIds, onRemove, onClose, onSelectItem, variant,
}: ComparePanelProps) {
  const items = useLiveQuery(async () => {
    if (resultIds.size === 0) return []
    return db.items.bulkGet([...resultIds]).then((rows: any[]) => rows.filter(Boolean))
  }, [Array.from(resultIds).sort((a, b) => a - b).join(',')]) ?? []

  const wrapperClass = variant === 'side'
    ? 'p-4 space-y-3'
    : 'border-t border-line bg-surface-1 px-3 py-3 space-y-2 max-h-[50%] overflow-y-auto'

  const isOnlyIn = typeof op === 'object' && 'onlyIn' in op

  return (
    <div className={wrapperClass}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Compare · {nodes.length}</p>
          <p className="text-sm font-medium text-ink">{opLabel(op, nodes)}</p>
        </div>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink-2 flex-shrink-0"
          aria-label="Close"
        >
          <Icons.close size={14} stroke={2} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {nodes.map((n) => (
          <CompareChip key={n.id} node={n} onRemove={() => onRemove(n.id)} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <OpButton label="∪ Union" active={op === 'union'} onClick={() => onChangeOp('union')} />
        <OpButton label="∩ Intersection" active={op === 'intersection'} onClick={() => onChangeOp('intersection')} />
        <OpButton label="⊕ Exclusive" active={op === 'symmetric'} onClick={() => onChangeOp('symmetric')} />
        {nodes.map((n) => (
          <OpButton
            key={`only-${n.id}`}
            label={`Only in ${truncate(n.label, 14)}`}
            active={isOnlyIn && (op as { onlyIn: string }).onlyIn === n.id}
            onClick={() => onChangeOp({ onlyIn: n.id })}
          />
        ))}
      </div>

      <p className="text-[11px] text-ink-3">
        {resultIds.size} item{resultIds.size !== 1 ? 's' : ''} match
      </p>

      <div className="space-y-1">
        {items.slice(0, variant === 'side' ? 60 : 12).map((item: any) => (
          <ItemSnippet key={item.id} item={item} onOpen={() => onSelectItem(item.id)} />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-ink-3 italic">No items match this operation.</p>
        )}
      </div>
    </div>
  )
}

function CompareChip({ node, onRemove }: { node: GraphNode; onRemove: () => void }) {
  const color = node.type === 'theme'
    ? (node.color.startsWith('var(') ? 'var(--ink-2)' : node.color)
    : 'var(--ink-3)'
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-surface-2"
      style={{ borderColor: color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block"
        style={{ backgroundColor: color }}
      />
      <span className="text-ink-2 max-w-[120px] truncate" title={node.label}>{node.label}</span>
      <button
        onClick={onRemove}
        className="text-ink-3 hover:text-red-500 ml-0.5"
        aria-label={`Remove ${node.label}`}
      >
        <Icons.close size={9} stroke={2} />
      </button>
    </span>
  )
}

function OpButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
        ${active
          ? 'bg-accent text-on-accent border-accent'
          : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
        }`}
    >
      {label}
    </button>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function ItemSnippet({ item, onOpen }: { item: any; onOpen: () => void }) {
  const content = (item.content || item.rawContent || '').trim()
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-2.5 py-2 rounded-lg bg-surface-2 border border-line hover:border-accent hover:bg-surface-3 transition-colors group"
      title="Open this item"
    >
      <div className="font-sans text-[13px] text-ink-2 line-clamp-2 leading-snug
        [&>p]:m-0 [&>p]:inline
        [&_strong]:text-ink [&_strong]:font-semibold
        [&_em]:italic
        [&_a]:text-accent [&_code]:text-accent [&_code]:font-mono [&_code]:text-[12px]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children }) => <span className="text-accent">{children}</span>,
          }}
        >{content.slice(0, 200)}</ReactMarkdown>
      </div>
      <p className="font-mono text-[10px] text-ink-3 mt-1 flex items-center justify-between uppercase tracking-wider">
        <span className="truncate normal-case tracking-normal font-sans">{item.domain || '—'}{item.date ? ` · ${item.date}` : ''}</span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent ml-2 flex-shrink-0">→</span>
      </p>
    </button>
  )
}
