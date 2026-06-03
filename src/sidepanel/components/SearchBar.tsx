import { useState, useEffect, useRef } from 'react'
import Fuse from 'fuse.js'
import { getAllItems } from '@/db/items'
import type { ResearchItem } from '@/types'
import { Icons } from './Icons'

interface Props { onResults: (results: ResearchItem[] | null) => void }

export function SearchBar({ onResults }: Props) {
  const [query, setQuery] = useState('')
  const fuseRef = useRef<Fuse<ResearchItem> | null>(null)

  useEffect(() => {
    getAllItems().then((items) => {
      fuseRef.current = new Fuse(items, {
        keys: ['content', 'notes', 'url', 'pageTitle'],
        threshold: 0.35,
        includeScore: true,
      })
    })
  }, [])

  function handleSearch(q: string) {
    setQuery(q)
    if (!q.trim()) { onResults(null); return }
    const results = fuseRef.current?.search(q).map((r) => r.item) ?? []
    onResults(results)
  }

  return (
    <div className="relative px-3 py-2 border-b border-line">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">
          <Icons.search size={14} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search your research..."
          className="w-full bg-surface-2 border border-line focus:border-line-strong rounded-lg
            pl-8 pr-8 py-1.5 text-sm text-ink placeholder-ink-3 outline-none transition-colors"
        />
        {query && (
          <button
            onClick={() => handleSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2"
          >
            <Icons.close size={14} stroke={2} />
          </button>
        )}
      </div>
    </div>
  )
}
