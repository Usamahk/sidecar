import { useState, useRef, useEffect } from 'react'
import { updateItem } from '@/db/items'
import type { ResearchItem } from '@/types'

interface Props { item: ResearchItem }

export function MetaEditor({ item }: Props) {
  const [editingUrl, setEditingUrl] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [urlValue, setUrlValue] = useState(item.url ?? '')
  const [dateValue, setDateValue] = useState(item.date ?? '')
  const urlRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingUrl) urlRef.current?.focus() }, [editingUrl])
  useEffect(() => { if (editingDate) dateRef.current?.focus() }, [editingDate])

  function saveUrl() {
    setEditingUrl(false)
    if (urlValue !== item.url) {
      const domain = (() => { try { return new URL(urlValue).hostname.replace(/^www\./, '') } catch { return urlValue } })()
      updateItem(item.id!, { url: urlValue, domain })
    }
  }

  function saveDate() {
    setEditingDate(false)
    if (dateValue !== item.date) updateItem(item.id!, { date: dateValue })
  }

  const displayDate = (() => {
    try { return new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return item.date }
  })()

  const inputCls = 'bg-surface-2 border border-line-strong rounded px-1 py-0.5 text-ink text-xs outline-none'

  return (
    <div className="flex items-center gap-2 text-xs text-ink-2 min-w-0">
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {item.favIconUrl && (
          <img src={item.favIconUrl} className="w-3 h-3 flex-shrink-0" alt=""
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        {editingUrl ? (
          <input ref={urlRef} value={urlValue} onChange={(e) => setUrlValue(e.target.value)}
            onBlur={saveUrl}
            onKeyDown={(e) => { if (e.key === 'Enter') saveUrl(); if (e.key === 'Escape') { setEditingUrl(false); setUrlValue(item.url) } }}
            className={`${inputCls} w-full min-w-0`} />
        ) : (
          <button onClick={() => setEditingUrl(true)}
            className="truncate hover:text-ink transition-colors max-w-[140px]" title={item.url}>
            {item.domain || item.url}
          </button>
        )}
      </div>

      <span className="text-ink-3">·</span>

      {editingDate ? (
        <input ref={dateRef} type="date" value={dateValue.slice(0, 10)}
          onChange={(e) => setDateValue(e.target.value)}
          onBlur={saveDate}
          onKeyDown={(e) => { if (e.key === 'Enter') saveDate(); if (e.key === 'Escape') { setEditingDate(false); setDateValue(item.date) } }}
          className={inputCls} />
      ) : (
        <button onClick={() => setEditingDate(true)}
          className="hover:text-ink transition-colors whitespace-nowrap flex-shrink-0">
          {displayDate}
        </button>
      )}
    </div>
  )
}
