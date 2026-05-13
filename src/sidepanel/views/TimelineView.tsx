import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '@/db/schema'
import { ResearchItem } from '../components/ResearchItem'
import { SearchBar } from '../components/SearchBar'
import type { ResearchItem as ResearchItemType } from '@/types'

type SortDir = 'desc' | 'asc'

export function TimelineView() {
  const [searchResults, setSearchResults] = useState<ResearchItemType[] | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const allItems = useLiveQuery(
    () => sortDir === 'desc'
      ? db.items.orderBy('date').reverse().toArray()
      : db.items.orderBy('date').toArray(),
    [sortDir]
  )

  const items = searchResults ?? allItems ?? []

  return (
    <div className="flex flex-col h-full">
      <SearchBar onResults={setSearchResults} />

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
            <p className="text-ink-2 text-sm font-medium mb-1">Nothing captured yet</p>
            <p className="text-ink-3 text-xs">Paste content above to start building your research timeline</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {searchResults !== null && (
              <p className="text-xs text-ink-3 px-1">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              </p>
            )}
            {items.map((item) => <ResearchItem key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}
