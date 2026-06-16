import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import {
  approveInsightProposal,
  rejectSuggestion,
  updateInsightProposal,
  dismissAllInsights,
} from '@/db/suggestions'
import type { Suggestion } from '@/types'
import { Icons } from './Icons'

export function InsightReviewQueue() {
  const proposals = useLiveQuery(
    () => db.suggestions
      .filter((s: Suggestion) => s.kind === 'insight-proposal')
      .toArray(),
    []
  )

  if (!proposals || proposals.length === 0) return null

  return (
    <section className="border-b border-line bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <h2 className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
          Insights to review <span className="text-ink-3 font-normal normal-case">({proposals.length})</span>
        </h2>
        <button
          onClick={() => { if (confirm('Dismiss all proposed insights?')) dismissAllInsights() }}
          className="text-xs text-ink-3 hover:text-ink-2 transition-colors"
        >
          Dismiss all
        </button>
      </div>

      <div className="px-3 py-2 space-y-2">
        {proposals.map((p: Suggestion) => <ProposalCard key={p.id} suggestion={p} />)}
      </div>
    </section>
  )
}

function ProposalCard({ suggestion }: { suggestion: Suggestion }) {
  const [editing, setEditing] = useState(false)
  const [headline, setHeadline] = useState(suggestion.proposedHeadline ?? '')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { setHeadline(suggestion.proposedHeadline ?? '') }, [suggestion.proposedHeadline])

  const themes = useLiveQuery(
    () => suggestion.supportingThemeIds && suggestion.supportingThemeIds.length > 0
      ? db.themes.bulkGet(suggestion.supportingThemeIds).then((rs: any[]) => rs.filter(Boolean))
      : Promise.resolve([] as any[]),
    [suggestion.supportingThemeIds?.join(',')]
  )

  const items = useLiveQuery(
    () => suggestion.supportingItemIds && suggestion.supportingItemIds.length > 0
      ? db.items.bulkGet(suggestion.supportingItemIds).then((rs: any[]) => rs.filter(Boolean))
      : Promise.resolve([] as any[]),
    [suggestion.supportingItemIds?.join(',')]
  )

  async function saveHeadline() {
    setEditing(false)
    const trimmed = headline.trim()
    if (!trimmed || trimmed === suggestion.proposedHeadline) {
      setHeadline(suggestion.proposedHeadline ?? '')
      return
    }
    await updateInsightProposal(suggestion.id!, { headline: trimmed })
  }

  const strength = suggestion.strength ?? 0
  const strengthLabel = strength >= 0.7 ? 'strong' : strength >= 0.4 ? 'medium' : 'weak'

  return (
    <div className="bg-surface-1 border border-line rounded-lg p-3">
      <div className="flex items-start gap-2 mb-1.5">
        <span
          className="mt-1 w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: 'var(--accent)' }}
          aria-hidden
        />
        {editing ? (
          <input
            autoFocus
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            onBlur={saveHeadline}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveHeadline()
              else if (e.key === 'Escape') { setHeadline(suggestion.proposedHeadline ?? ''); setEditing(false) }
            }}
            className="flex-1 bg-surface-2 border border-line-strong rounded px-2 py-0.5 text-sm text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 text-left text-sm font-medium text-ink hover:text-accent transition-colors"
            title="Rename"
          >
            {suggestion.proposedHeadline}
          </button>
        )}
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-0.5 flex-shrink-0" title={`strength ${(strength * 100).toFixed(0)}%`}>
          {strengthLabel}
        </span>
      </div>

      {suggestion.proposedRationale && (
        <p className="text-xs text-ink-2 italic mb-2 ml-5 leading-relaxed">
          {suggestion.proposedRationale}
        </p>
      )}

      <div className="flex flex-wrap gap-1 mb-2 ml-5">
        {(themes ?? []).map((t: any) => (
          <span
            key={t.id}
            className="text-[10px] px-1.5 py-0.5 rounded-full border"
            style={{ borderColor: t.color, color: t.color }}
          >
            {t.name}
          </span>
        ))}
      </div>

      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2 transition-colors ml-5 mb-2"
      >
        <Icons.chevron size={10} stroke={2}
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        Grounded in {suggestion.supportingItemIds?.length ?? 0} item{(suggestion.supportingItemIds?.length ?? 0) !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <ul className="ml-5 mb-2 space-y-1">
          {(items ?? []).map((item: any) => (
            <li key={item.id} className="text-xs text-ink-2 truncate" title={item.rawContent}>
              "{(item.rawContent || item.content || '').slice(0, 110)}{(item.rawContent || item.content || '').length > 110 ? '…' : ''}"
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-1.5 ml-5">
        <button
          onClick={() => rejectSuggestion(suggestion.id!)}
          className="text-xs px-2 py-1 rounded border border-line text-ink-3 hover:text-ink-2 hover:border-line-strong transition-colors"
        >
          Reject
        </button>
        <button
          onClick={() => approveInsightProposal(suggestion.id!)}
          className="text-xs px-2 py-1 rounded bg-accent text-on-accent hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
      </div>
    </div>
  )
}
