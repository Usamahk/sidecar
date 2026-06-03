import { useState, useRef, useEffect } from 'react'
import { updateItem } from '@/db/items'
import type { ResearchItem, SourceType } from '@/types'
import { Icons } from './Icons'

// Colors use dark: variants so they adapt to both themes
const SOURCE_CONFIG: Record<SourceType, { label: string; cls: string }> = {
  newsletter: {
    label: 'Newsletter',
    cls: 'bg-sky-100 dark:bg-sky-950 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400',
  },
  website: {
    label: 'Website',
    cls: 'bg-surface-2 border-line text-ink-2',
  },
  twitter: {
    label: 'X / Twitter',
    cls: 'bg-surface-2 border-line text-ink-2',
  },
  reddit: {
    label: 'Reddit',
    cls: 'bg-orange-100 dark:bg-orange-950 border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-400',
  },
  product: {
    label: 'Product',
    cls: 'bg-violet-100 dark:bg-violet-950 border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-400',
  },
  internal: {
    label: 'Internal',
    cls: 'bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400',
  },
}

const SOURCE_TYPES: SourceType[] = ['newsletter', 'website', 'twitter', 'reddit', 'product', 'internal']

interface Props { item: ResearchItem }

export function SourceTag({ item }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [editingSender, setEditingSender] = useState(false)
  const [senderValue, setSenderValue] = useState(item.sourceSender ?? '')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const sourceType = item.sourceType ?? 'website'
  const config = SOURCE_CONFIG[sourceType]

  useEffect(() => {
    if (!dropdownOpen) return
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [dropdownOpen])

  useEffect(() => { if (editingSender) inputRef.current?.focus() }, [editingSender])

  function selectType(type: SourceType) {
    setDropdownOpen(false)
    if (type !== sourceType) updateItem(item.id!, { sourceType: type })
  }

  function saveSender() {
    setEditingSender(false)
    if (senderValue !== item.sourceSender) updateItem(item.id!, { sourceSender: senderValue })
  }

  const showSender = sourceType === 'newsletter' || sourceType === 'internal'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors hover:opacity-80 ${config.cls}`}
        >
          <span>{config.label}</span>
          <Icons.chevron size={10} stroke={2} style={{ transform: 'rotate(90deg)', opacity: 0.6 }} />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-surface-1 border border-line rounded-lg shadow-xl overflow-hidden min-w-[140px]">
            {SOURCE_TYPES.map((type) => {
              const c = SOURCE_CONFIG[type]
              const active = type === sourceType
              return (
                <button
                  key={type}
                  onClick={() => selectType(type)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
                    ${active ? 'bg-surface-3 text-ink font-medium' : 'text-ink-2 hover:bg-surface-2'}`}
                >
                  <span>{c.label}</span>
                  {active && <span className="ml-auto text-ink-3"><Icons.check size={12} stroke={2} /></span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showSender && (
        editingSender ? (
          <input
            ref={inputRef}
            value={senderValue}
            onChange={(e) => setSenderValue(e.target.value)}
            onBlur={saveSender}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveSender()
              if (e.key === 'Escape') { setEditingSender(false); setSenderValue(item.sourceSender) }
            }}
            placeholder={sourceType === 'newsletter' ? 'Sender name...' : 'Label...'}
            className="bg-surface-2 border border-line-strong rounded px-2 py-0.5 text-xs text-ink outline-none w-32"
          />
        ) : (
          <button
            onClick={() => setEditingSender(true)}
            className={`text-xs transition-colors ${item.sourceSender ? 'text-ink-2 hover:text-ink' : 'text-ink-3 hover:text-ink-2 italic'}`}
          >
            {item.sourceSender || (sourceType === 'newsletter' ? '+ sender' : '+ label')}
          </button>
        )
      )}
    </div>
  )
}
