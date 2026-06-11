import { useState, useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import {
  approveConceptAssignment,
  approveConceptProposal,
  rejectSuggestion,
  bulkApproveByConcept,
  bulkRejectByConcept,
  updateConceptProposal,
  dismissAllConcepts,
} from '@/db/suggestions'
import type { Suggestion, Concept } from '@/types'
import { Icons } from './Icons'

export function ConceptReviewQueue() {
  const suggestions = useLiveQuery(
    () => db.suggestions
      .filter((s: Suggestion) => s.kind === 'concept-assignment' || s.kind === 'concept-proposal')
      .toArray(),
    []
  )
  const concepts = useLiveQuery(() => db.concepts.toArray(), [])

  if (!suggestions || suggestions.length === 0) return null

  const proposals = suggestions.filter((s: Suggestion) => s.kind === 'concept-proposal')
  const assignments = suggestions.filter((s: Suggestion) => s.kind === 'concept-assignment')

  return (
    <section className="border-b border-line bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <h2 className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
          Concept review <span className="text-ink-3 font-normal normal-case">({suggestions.length})</span>
        </h2>
        <button
          onClick={() => { if (confirm('Dismiss all concept suggestions?')) dismissAllConcepts() }}
          className="text-xs text-ink-3 hover:text-ink-2 transition-colors"
        >
          Dismiss all
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="px-3 py-2 space-y-2">
          <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">New concepts</h3>
          {proposals.map((p: Suggestion) => <ProposalCard key={p.id} suggestion={p} />)}
        </div>
      )}

      {assignments.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 border-t border-line">
          <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Tag suggestions</h3>
          <AssignmentGroups suggestions={assignments} concepts={concepts ?? []} />
        </div>
      )}
    </section>
  )
}

function ProposalCard({ suggestion }: { suggestion: Suggestion }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(suggestion.proposedName ?? '')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { setName(suggestion.proposedName ?? '') }, [suggestion.proposedName])

  const supportCount = suggestion.supportingItemIds?.length ?? 0

  async function saveName() {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === suggestion.proposedName) {
      setName(suggestion.proposedName ?? '')
      return
    }
    await updateConceptProposal(suggestion.id!, { name: trimmed })
  }

  return (
    <div className="bg-surface-1 border border-line rounded-lg p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: 'var(--accent)' }}
          aria-hidden
        />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              else if (e.key === 'Escape') { setName(suggestion.proposedName ?? ''); setEditing(false) }
            }}
            className="flex-1 bg-surface-2 border border-line-strong rounded px-2 py-0.5 text-sm text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 text-left text-sm font-medium text-ink truncate hover:text-accent transition-colors"
            title="Rename"
          >
            {suggestion.proposedName}
          </button>
        )}
      </div>

      {suggestion.proposedDescription && (
        <p className="text-xs text-ink-3 italic mb-1.5 ml-5">"{suggestion.proposedDescription}"</p>
      )}

      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2 transition-colors ml-5 mb-1.5"
      >
        <Icons.chevron size={10} stroke={2}
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        Found in {supportCount} item{supportCount !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <ul className="ml-5 mb-2 space-y-1">
          {suggestion.supportingItemIds?.map((id) => (
            <ItemSnippet key={id} itemId={id} />
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
          onClick={() => approveConceptProposal(suggestion.id!)}
          className="text-xs px-2 py-1 rounded bg-accent text-on-accent hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
      </div>
    </div>
  )
}

interface GroupsProps {
  suggestions: Suggestion[]
  concepts: Concept[]
}

function AssignmentGroups({ suggestions, concepts }: GroupsProps) {
  const groups = useMemo(() => {
    const byConcept = new Map<number, Suggestion[]>()
    for (const s of suggestions) {
      if (s.conceptId == null) continue
      const arr = byConcept.get(s.conceptId) ?? []
      arr.push(s)
      byConcept.set(s.conceptId, arr)
    }
    return Array.from(byConcept.entries())
      .map(([conceptId, items]) => ({
        concept: concepts.find((c) => c.id === conceptId),
        items: items.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
      }))
      .filter((g) => g.concept)
      .sort((a, b) => b.items.length - a.items.length)
  }, [suggestions, concepts])

  return (
    <>
      {groups.map(({ concept, items }) => (
        <AssignmentGroup key={concept!.id} concept={concept!} items={items} />
      ))}
    </>
  )
}

function AssignmentGroup({ concept, items }: { concept: Concept; items: Suggestion[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-surface-1 border border-line rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icons.chevron size={10} stroke={2}
            style={{ color: 'var(--ink-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}
          />
          <span className="text-sm text-ink truncate">{concept.name}</span>
          <span className="text-xs text-ink-3 tabular-nums">({items.length})</span>
        </button>
        <button
          onClick={() => bulkApproveByConcept(concept.id!)}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-accent hover:bg-accent/10 transition-colors"
          title="Approve all"
        >
          <Icons.check size={11} stroke={2} /> all
        </button>
        <button
          onClick={() => bulkRejectByConcept(concept.id!)}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-ink-3 hover:text-red-500 hover:bg-red-500/10 transition-colors"
          title="Reject all"
        >
          <Icons.close size={11} stroke={2} /> all
        </button>
      </div>

      {expanded && (
        <ul className="border-t border-line divide-y divide-line">
          {items.map((s) => (
            <AssignmentRow key={s.id} suggestion={s} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AssignmentRow({ suggestion }: { suggestion: Suggestion }) {
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-2 transition-colors group">
      <div className="flex-1 min-w-0">
        <ItemSnippet itemId={suggestion.itemId!} />
      </div>
      <span className="text-[10px] text-ink-3 tabular-nums flex-shrink-0">
        {Math.round((suggestion.confidence ?? 0) * 100)}%
      </span>
      <button
        onClick={() => approveConceptAssignment(suggestion.id!)}
        className="text-accent hover:opacity-80 opacity-0 group-hover:opacity-100 transition-opacity px-1"
        aria-label="Approve"
      >
        <Icons.check size={13} stroke={2} />
      </button>
      <button
        onClick={() => rejectSuggestion(suggestion.id!)}
        className="text-ink-3 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-1"
        aria-label="Reject"
      >
        <Icons.close size={13} stroke={2} />
      </button>
    </li>
  )
}

function ItemSnippet({ itemId }: { itemId: number }) {
  const item = useLiveQuery(() => db.items.get(itemId), [itemId])
  if (!item) return <span className="text-xs text-ink-3 italic">(deleted)</span>
  const text = (item.rawContent || item.content).replace(/\s+/g, ' ').trim()
  return (
    <span className="text-xs text-ink-2 truncate block" title={text}>
      "{text.slice(0, 80)}{text.length > 80 ? '…' : ''}"
    </span>
  )
}
