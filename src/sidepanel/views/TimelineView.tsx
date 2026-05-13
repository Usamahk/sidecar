import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useMemo } from 'react'
import { db } from '@/db/schema'
import { ResearchItem } from '../components/ResearchItem'
import { SearchBar } from '../components/SearchBar'
import type { ResearchItem as ResearchItemType, Theme } from '@/types'

type SortDir = 'desc' | 'asc'

export function TimelineView() {
  const [searchResults, setSearchResults] = useState<ResearchItemType[] | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [themeFilter, setThemeFilter] = useState<number | null>(null)

  const allItems = useLiveQuery(
    () => sortDir === 'desc'
      ? db.items.orderBy('date').reverse().toArray()
      : db.items.orderBy('date').toArray(),
    [sortDir]
  )

  const themes = useLiveQuery(() => db.themes.orderBy('name').toArray(), [])

  const items = useMemo(() => {
    let list: ResearchItemType[] = searchResults ?? allItems ?? []
    if (themeFilter !== null) {
      list = list.filter((item) => item.themeIds.includes(themeFilter))
    }
    return list
  }, [searchResults, allItems, themeFilter])

  const isFiltering = themeFilter !== null
  const isSearching = searchResults !== null

  return (
    <div className="flex flex-col h-full">
      <SearchBar onResults={setSearchResults} />

      {themes && themes.length > 0 && (
        <div className="flex gap-1.5 px-3 py-1.5 border-b border-line overflow-x-auto scrollbar-thin">
          <FilterChip
            label="All"
            active={themeFilter === null}
            onClick={() => setThemeFilter(null)}
          />
          {themes.map((t: Theme) => (
            <FilterChip
              key={t.id}
              label={t.name}
              color={t.color}
              active={themeFilter === t.id}
              onClick={() => setThemeFilter((current) => current === t.id ? null : t.id!)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end px-3 py-1.5 border-b border-line">
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2 transition-colors"
        >
          <span>Date</span>
          <span className="text-[11px]">{sortDir === 'desc' ? '↓' : '↑'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="text-4xl mb-4">📋</div>
            <p className="text-ink-2 text-sm font-medium mb-1">
              {isFiltering || isSearching ? 'No matches' : 'Nothing captured yet'}
            </p>
            <p className="text-ink-3 text-xs">
              {isFiltering || isSearching
                ? 'Try a different filter or clear the search'
                : 'Paste content above to start building your research timeline'}
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {(isSearching || isFiltering) && (
              <p className="text-xs text-ink-3 px-1">
                {items.length} result{items.length !== 1 ? 's' : ''}
              </p>
            )}
            {items.map((item) => <ResearchItem key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}

interface FilterChipProps {
  label: string
  color?: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, color, active, onClick }: FilterChipProps) {
  const baseStyle = color && active
    ? { backgroundColor: color + '33', borderColor: color, color }
    : color
      ? { borderColor: color + '55', color }
      : undefined

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? color ? '' : 'bg-accent/15 border-accent text-accent'
          : color ? 'hover:bg-surface-2' : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'
      }`}
      style={baseStyle}
    >
      {label}
    </button>
  )
}
