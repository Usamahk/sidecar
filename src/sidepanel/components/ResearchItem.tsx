import { useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { updateItem, deleteItem } from '@/db/items'
import { addAttachment } from '@/db/attachments'
import { MetaEditor } from './MetaEditor'
import { ThemeTag } from './ThemeTag'
import { ThemePicker } from './ThemePicker'
import { SourceTag } from './SourceTag'
import { AttachmentList } from './AttachmentView'
import { Icons } from './Icons'
import type { ResearchItem as ResearchItemType } from '@/types'

interface Props { item: ResearchItemType }

export function ResearchItem({ item }: Props) {
  const [notes, setNotes] = useState(item.notes ?? '')
  const [content, setContent] = useState(item.content ?? '')
  const [editingContent, setEditingContent] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const saveNotes = useCallback(() => {
    if (notes !== item.notes) updateItem(item.id!, { notes })
  }, [notes, item.id, item.notes])

  const saveContent = useCallback(() => {
    setEditingContent(false)
    if (content !== item.content) updateItem(item.id!, { content, rawContent: content })
  }, [content, item.id, item.content])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file?.type.startsWith('image/')) addAttachment(item.id!, file)
    e.target.value = ''
  }

  return (
    <article className="bg-surface-1 rounded-xl border border-line hover:border-line-strong transition-colors overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <MetaEditor item={item} />
          <SourceTag item={item} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setExpanded(!expanded)}
            className="text-ink-3 hover:text-ink-2 transition-colors p-0.5"
            aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <Icons.minus size={14} /> : <Icons.add size={14} />}
          </button>
          <button onClick={() => { if (confirm('Delete this item?')) deleteItem(item.id!) }}
            className="text-ink-3 hover:text-red-500 transition-colors p-0.5"
            aria-label="Delete item">
            <Icons.close size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <AttachmentList itemId={item.id!} />

          <div className="px-4 pb-3">
            {editingContent ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={saveContent}
                onKeyDown={(e) => { if (e.key === 'Escape') { setContent(item.content); setEditingContent(false) } }}
                autoFocus
                rows={6}
                className="w-full bg-surface-2 border border-line-strong focus:border-line-strong rounded-lg px-3 py-2
                  text-sm text-ink resize-none outline-none transition-colors"
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setEditingContent(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditingContent(true) }}
                className="group relative cursor-text"
                title="Click to edit"
              >
                {content.trim() ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                    prose-p:my-1 prose-headings:text-ink prose-a:text-accent prose-code:text-accent
                    prose-blockquote:border-accent prose-blockquote:text-ink-2">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            onClick={(e) => { e.preventDefault(); if (href) chrome.tabs.create({ url: href }) }}
                            className="text-accent underline cursor-pointer hover:opacity-80"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >{content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-ink-3 italic">No content — click to add</p>
                )}
                <span className="absolute top-0 right-0 text-[10px] text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  edit
                </span>
              </div>
            )}
          </div>

          <div className="mx-4 border-t border-line" />

          <div className="px-4 py-3">
            <label className="block text-xs text-ink-3 mb-1.5 font-medium">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add your thoughts..."
              rows={2}
              className="w-full bg-surface-2 border border-line focus:border-line-strong rounded-lg px-3 py-2
                text-sm text-ink placeholder-ink-3 resize-none outline-none transition-colors"
            />
          </div>

          <div className="px-4 pb-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {item.themeIds.map((themeId) => (
                <ThemeTag key={themeId} themeId={themeId} itemId={item.id!} />
              ))}
              <ThemePicker itemId={item.id!} assignedThemeIds={item.themeIds} />
            </div>
            <button onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 text-ink-3 hover:text-ink-2 transition-colors"
              title="Attach screenshot">
              <Icons.image size={14} />
            </button>
          </div>
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
    </article>
  )
}
