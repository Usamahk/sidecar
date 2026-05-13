import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { addTheme, assignTheme } from '@/db/themes'
import type { Theme } from '@/types'

interface Props {
  itemId: number
  assignedThemeIds: number[]
}

export function ThemePicker({ itemId, assignedThemeIds }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const themes = useLiveQuery(() => db.themes.orderBy('name').toArray(), [])

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const available = (themes ?? []).filter(
    (t: Theme) => !assignedThemeIds.includes(t.id!) &&
      t.name.toLowerCase().includes(query.toLowerCase())
  )

  const exactMatch = (themes ?? []).some(
    (t: Theme) => t.name.toLowerCase() === query.trim().toLowerCase()
  )

  async function handleAssign(themeId: number) {
    await assignTheme(itemId, themeId)
    setOpen(false)
    setQuery('')
  }

  async function handleCreate() {
    const name = query.trim()
    if (!name || exactMatch) return
    const newId = await addTheme(name)
    await assignTheme(itemId, newId as number)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
          border border-dashed border-line-strong text-ink-3 hover:text-ink-2 hover:border-ink-3 transition-colors"
        aria-label="Add theme"
      >
        + theme
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-20 w-56 bg-surface-1 border border-line-strong rounded-lg shadow-lg overflow-hidden">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim() && !exactMatch) handleCreate()
            }}
            placeholder="Find or create..."
            className="w-full px-3 py-2 text-sm bg-surface-2 border-b border-line text-ink placeholder-ink-3 outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {available.length === 0 && !query.trim() && (
              <p className="px-3 py-2 text-xs text-ink-3 italic">
                {themes && themes.length > 0 ? 'All themes already assigned' : 'No themes yet — type to create one'}
              </p>
            )}
            {available.map((t: Theme) => (
              <button
                key={t.id}
                onClick={() => handleAssign(t.id!)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-surface-2 transition-colors"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="truncate">{t.name}</span>
              </button>
            ))}
            {query.trim() && !exactMatch && (
              <button
                onClick={handleCreate}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-surface-2 transition-colors border-t border-line"
              >
                <span className="text-ink-3">＋</span>
                <span>Create <span className="font-medium">"{query.trim()}"</span></span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
