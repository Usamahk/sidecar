import { useState, useRef, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { addTheme, updateTheme, deleteTheme, THEME_COLORS } from '@/db/themes'
import { ScanPanel } from '../components/ScanPanel'
import { ReviewQueue } from '../components/ReviewQueue'
import { ResearchItem } from '../components/ResearchItem'
import type { Theme, ResearchItem as ResearchItemType } from '@/types'

export function ThemesView() {
  const [newName, setNewName] = useState('')
  const themes = useLiveQuery(() => db.themes.orderBy('name').toArray(), [])
  const suggestionCount = useLiveQuery(() => db.suggestions.count(), [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    await addTheme(name)
    setNewName('')
  }

  return (
    <div className="flex flex-col h-full">
      <form
        onSubmit={handleCreate}
        className="flex gap-2 px-3 py-2 border-b border-line bg-surface-1"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New theme name..."
          className="flex-1 bg-surface-2 border border-line focus:border-line-strong rounded-lg
            px-3 py-1.5 text-sm text-ink placeholder-ink-3 outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white
            disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Add
        </button>
      </form>

      <ScanPanel />

      <div className="flex-1 overflow-y-auto">
        <ReviewQueue />

        {(!themes || themes.length === 0) && !suggestionCount ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="text-4xl mb-4">🗂️</div>
            <p className="text-ink-2 text-sm font-medium mb-1">No themes yet</p>
            <p className="text-ink-3 text-xs">Create one above, or run Scan to discover them</p>
          </div>
        ) : !themes || themes.length === 0 ? null : (
          <ul className="p-3 space-y-2">
            {themes.map((theme: Theme) => (
              <ThemeRow key={theme.id} theme={theme} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ThemeRow({ theme }: { theme: Theme }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(theme.name)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const itemCount = useLiveQuery(
    () => db.items.where('themeIds').equals(theme.id!).count(),
    [theme.id]
  )

  const expandedItems = useLiveQuery(
    async () => {
      if (!expanded) return [] as ResearchItemType[]
      const items = await db.items.where('themeIds').equals(theme.id!).toArray()
      return items.sort((a: ResearchItemType, b: ResearchItemType) => b.date.localeCompare(a.date))
    },
    [theme.id, expanded]
  )

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

  async function saveName() {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === theme.name) {
      setName(theme.name)
      return
    }
    await updateTheme(theme.id!, { name: trimmed })
  }

  async function handleDelete() {
    const msg = itemCount && itemCount > 0
      ? `Delete "${theme.name}"? It will be removed from ${itemCount} item${itemCount !== 1 ? 's' : ''}.`
      : `Delete "${theme.name}"?`
    if (confirm(msg)) await deleteTheme(theme.id!)
  }

  const hasItems = (itemCount ?? 0) > 0

  return (
    <li className="bg-surface-1 rounded-lg border border-line overflow-hidden group">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="w-5 h-5 rounded-full border border-line-strong flex-shrink-0 hover:scale-110 transition-transform"
            style={{ backgroundColor: theme.color }}
            aria-label="Change color"
          />
          {pickerOpen && (
            <div className="absolute top-7 left-0 z-10 bg-surface-1 border border-line-strong rounded-lg p-2 shadow-lg grid grid-cols-5 gap-1.5">
              {THEME_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    updateTheme(theme.id!, { color: c })
                    setPickerOpen(false)
                  }}
                  className="w-5 h-5 rounded-full border border-line-strong hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                  aria-label={`Pick color ${c}`}
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
              else if (e.key === 'Escape') { setName(theme.name); setEditing(false) }
            }}
            className="flex-1 bg-surface-2 border border-line-strong rounded px-2 py-0.5 text-sm text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 text-left text-sm text-ink truncate hover:text-accent transition-colors"
            title="Rename"
          >
            {theme.name}
          </button>
        )}

        <button
          onClick={() => hasItems && setExpanded((e) => !e)}
          disabled={!hasItems}
          className="flex items-center gap-1 text-xs text-ink-3 tabular-nums flex-shrink-0
            hover:text-ink-2 disabled:cursor-default disabled:hover:text-ink-3 transition-colors px-1"
          title={hasItems ? (expanded ? 'Collapse' : 'Show items') : 'No items tagged'}
          aria-label={expanded ? 'Collapse items' : 'Expand items'}
        >
          <span>{itemCount ?? 0}</span>
          {hasItems && (
            <span className="text-[10px] leading-none">{expanded ? '▾' : '▸'}</span>
          )}
        </button>

        <button
          onClick={handleDelete}
          className="text-ink-3 hover:text-red-500 transition-colors text-xs px-1 opacity-0 group-hover:opacity-100"
          aria-label="Delete theme"
        >
          ✕
        </button>
      </div>

      {expanded && hasItems && (
        <div className="border-t border-line bg-surface px-3 py-2 space-y-2">
          {expandedItems && expandedItems.length > 0 ? (
            expandedItems.map((item: ResearchItemType) => (
              <ResearchItem key={item.id} item={item} />
            ))
          ) : (
            <p className="text-xs text-ink-3 italic px-1 py-2">Loading…</p>
          )}
        </div>
      )}
    </li>
  )
}
