import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { deleteInsight } from '@/db/insights'
import type { Insight, Theme } from '@/types'
import { Icons } from './Icons'

interface Props {
  selectedInsightId: string | null
  onSelect: (insightId: string | null) => void
  /** Map from insight db id → blob colour (so list swatches match canvas blobs). */
  colorFor: (insightId: number) => string
  /** "panel" is the narrow side-panel context, "fullpage" the wider pop-out. */
  variant: 'panel' | 'fullpage'
}

export function InsightsList({ selectedInsightId, onSelect, colorFor, variant }: Props) {
  const insights = useLiveQuery(
    () => db.insights.orderBy('generatedAt').reverse().toArray(),
    []
  )
  const themes = useLiveQuery(() => db.themes.toArray(), [])

  if (!insights || insights.length === 0) {
    return (
      <div className="p-6 text-xs text-ink-3 leading-relaxed">
        <p className="text-ink-2 font-medium mb-1">No insights yet.</p>
        <p>Click <strong>Surface insights</strong> above to look for cross-theme patterns once you have a few themes tagged.</p>
      </div>
    )
  }

  const themeById = new Map<number, Theme>((themes ?? []).map((t: Theme) => [t.id!, t]))

  async function handleDelete(id: number) {
    if (!confirm('Delete this insight?')) return
    if (selectedInsightId === `insight-${id}`) onSelect(null)
    await deleteInsight(id)
  }

  return (
    <div className={variant === 'fullpage' ? 'p-3 space-y-1.5' : 'p-2 space-y-1.5'}>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 px-1 mb-1">
        Insights · {insights.length}
      </p>
      {insights.map((insight: Insight) => {
        const id = `insight-${insight.id}`
        const selected = selectedInsightId === id
        const color = colorFor(insight.id!)
        const strengthLabel = insight.strength >= 0.7 ? '●●●' : insight.strength >= 0.4 ? '●●○' : '●○○'
        return (
          <div
            key={insight.id}
            className={`group rounded-lg border transition-colors cursor-pointer
              ${selected
                ? 'bg-surface-2 border-line-strong'
                : 'border-line hover:border-line-strong hover:bg-surface-1'
              }`}
            onClick={() => onSelect(id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(id) }}
          >
            <div className="px-2.5 py-2">
              <div className="flex items-start gap-2 mb-1">
                <span
                  className="mt-1 w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-medium leading-snug ${selected ? 'text-ink' : 'text-ink-2'}`}>
                    {insight.headline}
                  </p>
                  {insight.rationale && (
                    <p className="text-[11px] text-ink-3 italic mt-0.5 line-clamp-2 leading-snug">
                      {insight.rationale}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(insight.id!) }}
                  className="text-ink-3 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  aria-label="Delete insight"
                  title="Delete"
                >
                  <Icons.close size={12} stroke={2} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 ml-4 flex-wrap">
                <span
                  className="font-mono text-[10px] text-ink-3"
                  title={`strength ${(insight.strength * 100).toFixed(0)}%`}
                >
                  {strengthLabel}
                </span>
                {insight.themeIds.slice(0, 4).map((tid) => {
                  const theme = themeById.get(tid)
                  if (!theme) return null
                  return (
                    <span
                      key={tid}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border"
                      style={{ borderColor: theme.color, color: theme.color }}
                    >
                      {theme.name}
                    </span>
                  )
                })}
                {insight.themeIds.length > 4 && (
                  <span className="text-[10px] text-ink-3">+{insight.themeIds.length - 4}</span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
