import { useState, useEffect, useRef, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { THEME_COLORS } from '@/db/themes'
import {
  approveAssignment,
  approveProposal,
  rejectSuggestion,
  bulkApproveByTheme,
  bulkRejectByTheme,
  updateProposal,
  dismissAll,
} from '@/db/suggestions'
import type { Suggestion, Theme } from '@/types'
import { Icons } from './Icons'

export function ReviewQueue() {
  const suggestions = useLiveQuery(() => db.suggestions.toArray(), [])
  const themes = useLiveQuery(() => db.themes.toArray(), [])

  if (!suggestions || suggestions.length === 0) return null

  const proposals = suggestions.filter((s: Suggestion) => s.kind === 'proposal')
  const assignments = suggestions.filter((s: Suggestion) => s.kind === 'assignment')

  return (
    <section className="border-b border-line bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <h2 className="text-xs font-semibold text-ink-2 uppercase tracking-wide">
          Review <span className="text-ink-3 font-normal normal-case">({suggestions.length})</span>
        </h2>
        <button
          onClick={() => { if (confirm('Dismiss all suggestions?')) dismissAll() }}
          className="text-xs text-ink-3 hover:text-ink-2 transition-colors"
        >
          Dismiss all
        </button>
      </div>

      {proposals.length > 0 && (
        <div className="px-3 py-2 space-y-2">
          <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">New themes</h3>
          {proposals.map((p: Suggestion) => <ProposalCard key={p.id} suggestion={p} />)}
        </div>
      )}

      {assignments.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 border-t border-line">
          <h3 className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Tag suggestions</h3>
          <AssignmentGroups suggestions={assignments} themes={themes ?? []} />
        </div>
      )}
    </section>
  )
}

function ProposalCard({ suggestion }: { suggestion: Suggestion }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(suggestion.proposedName ?? '')
  const [expanded, setExpanded] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setName(suggestion.proposedName ?? '') }, [suggestion.proposedName])

  useEffect(() => {
    if (!pickerOpen) return
    function handle(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [pickerOpen])

  const color = suggestion.proposedColor ?? '#6366f1'
  const supportCount = suggestion.supportingItemIds?.length ?? 0

  async function saveName() {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === suggestion.proposedName) {
      setName(suggestion.proposedName ?? '')
      return
    }
    await updateProposal(suggestion.id!, { name: trimmed })
  }

  return (
    <div className="bg-surface-1 border border-line rounded-lg p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="w-4 h-4 rounded-full border border-line-strong hover:scale-110 transition-transform flex-shrink-0"
            style={{ backgroundColor: color }}
            aria-label="Pick color"
          />
          {pickerOpen && (
            <div className="absolute top-6 left-0 z-20 bg-surface-1 border border-line-strong rounded-lg p-2 shadow-lg grid grid-cols-5 gap-1.5">
              {THEME_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    updateProposal(suggestion.id!, { color: c })
                    setPickerOpen(false)
                  }}
                  className="w-5 h-5 rounded-full border border-line-strong hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>

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
        <p className="text-xs text-ink-3 italic mb-1.5 ml-6">"{suggestion.proposedDescription}"</p>
      )}

      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2 transition-colors ml-6 mb-1.5"
      >
        <Icons.chevron size={10} stroke={2}
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        Found in {supportCount} item{supportCount !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <ul className="ml-6 mb-2 space-y-1">
          {suggestion.supportingItemIds?.map((id) => (
            <ItemSnippet key={id} itemId={id} />
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-1.5 ml-6">
        <button
          onClick={() => rejectSuggestion(suggestion.id!)}
          className="text-xs px-2 py-1 rounded border border-line text-ink-3 hover:text-ink-2 hover:border-line-strong transition-colors"
        >
          Reject
        </button>
        <button
          onClick={() => approveProposal(suggestion.id!)}
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
  themes: Theme[]
}

function AssignmentGroups({ suggestions, themes }: GroupsProps) {
  const groups = useMemo(() => {
    const byTheme = new Map<number, Suggestion[]>()
    for (const s of suggestions) {
      if (s.themeId == null) continue
      const arr = byTheme.get(s.themeId) ?? []
      arr.push(s)
      byTheme.set(s.themeId, arr)
    }
    return Array.from(byTheme.entries())
      .map(([themeId, items]) => ({
        theme: themes.find((t) => t.id === themeId),
        items: items.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
      }))
      .filter((g) => g.theme)
      .sort((a, b) => b.items.length - a.items.length)
  }, [suggestions, themes])

  return (
    <>
      {groups.map(({ theme, items }) => (
        <AssignmentGroup key={theme!.id} theme={theme!} items={items} />
      ))}
    </>
  )
}

function AssignmentGroup({ theme, items }: { theme: Theme; items: Suggestion[] }) {
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
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: theme.color }}
          />
          <span className="text-sm text-ink truncate">{theme.name}</span>
          <span className="text-xs text-ink-3 tabular-nums">({items.length})</span>
        </button>
        <button
          onClick={() => bulkApproveByTheme(theme.id!)}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-accent hover:bg-accent/10 transition-colors"
          title="Approve all"
        >
          <Icons.check size={11} stroke={2} /> all
        </button>
        <button
          onClick={() => bulkRejectByTheme(theme.id!)}
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
        onClick={() => approveAssignment(suggestion.id!)}
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
