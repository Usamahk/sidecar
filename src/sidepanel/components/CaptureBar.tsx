import { useState, useRef } from 'react'
import { addItem } from '@/db/items'
import { addAttachment } from '@/db/attachments'
import { useCurrentTab } from '@/hooks/useCurrentUrl'

function extractClipboardImage(items: DataTransferItemList): Blob | null {
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

// Convert pasted HTML to markdown, preserving hyperlinks as [text](url)
function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  function nodeToMarkdown(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''

    const el = node as Element
    const children = Array.from(node.childNodes).map(nodeToMarkdown).join('')

    switch (el.tagName?.toLowerCase()) {
      case 'a': {
        const href = el.getAttribute('href')?.trim()
        const label = children.trim()
        if (href && label && href !== label) return `[${label}](${href})`
        if (href) return href
        return label
      }
      case 'b':
      case 'strong': return `**${children}**`
      case 'i':
      case 'em': return `*${children}*`
      case 'code': return `\`${children}\``
      case 'br': return '\n'
      case 'p': return `${children}\n\n`
      case 'li': return `- ${children}\n`
      case 'ul':
      case 'ol': return `${children}\n`
      case 'h1': return `# ${children}\n\n`
      case 'h2': return `## ${children}\n\n`
      case 'h3': return `### ${children}\n\n`
      case 'blockquote': return children.split('\n').map(l => `> ${l}`).join('\n') + '\n'
      default: return children
    }
  }

  return nodeToMarkdown(doc.body).replace(/\n{3,}/g, '\n\n').trim()
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function CaptureBar() {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingImage, setPendingImage] = useState<Blob | null>(null)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [captureDate, setCaptureDate] = useState(todayISO)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentTab = useCurrentTab()

  function attachImage(blob: Blob) {
    if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl)
    setPendingImage(blob)
    setPendingImageUrl(URL.createObjectURL(blob))
  }

  function clearImage() {
    if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl)
    setPendingImage(null)
    setPendingImageUrl(null)
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (!e.clipboardData?.items) return

    // Image takes priority
    const image = extractClipboardImage(e.clipboardData.items)
    if (image) { e.preventDefault(); attachImage(image); return }

    // If HTML is available, convert to markdown to preserve links
    const html = e.clipboardData.getData('text/html')
    if (html) {
      e.preventDefault()
      const markdown = htmlToMarkdown(html)
      const ta = textareaRef.current
      if (ta) {
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const next = text.slice(0, start) + markdown + text.slice(end)
        setText(next)
        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + markdown.length
        })
      } else {
        setText((t) => t + markdown)
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) attachImage(file)
  }

  async function handleCapture() {
    const trimmed = text.trim()
    if (!trimmed && !pendingImage) return

    const itemId = await addItem({
      rawContent: trimmed,
      url: currentTab.url || '',
      pageTitle: currentTab.title || '',
      date: captureDate,
      sourceSender: currentTab.senderName || '',
    })

    if (pendingImage) { await addAttachment(itemId, pendingImage); clearImage() }
    setText('')
    setCaptureDate(todayISO())
    textareaRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleCapture() }
    if (e.key === 'Escape') { setText(''); clearImage(); textareaRef.current?.blur() }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file?.type.startsWith('image/')) attachImage(file)
    e.target.value = ''
  }

  const domain = (() => { try { return new URL(currentTab.url).hostname.replace(/^www\./, '') } catch { return null } })()
  const isGmail = domain === 'mail.google.com'
  const sourceLabel = isGmail
    ? currentTab.senderName ? `Newsletter · ${currentTab.senderName}` : 'Newsletter'
    : domain ? `from ${domain}` : 'no URL captured'

  const hasContent = text.trim() || pendingImage
  const isActive = isFocused || !!hasContent || isDragOver

  return (
    <div
      className={`bg-surface-1 border-b transition-colors
        ${isDragOver ? 'border-accent' : isActive ? 'border-line-strong' : 'border-line'}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="p-3 space-y-2">
        {pendingImageUrl && (
          <div className="relative">
            <img src={pendingImageUrl} alt="Screenshot to attach"
              className="rounded-lg border border-line max-h-32 w-full object-cover" />
            <button onClick={clearImage}
              className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-surface/80 text-ink-3
                hover:text-red-500 flex items-center justify-center text-xs">
              ✕
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          placeholder={isDragOver ? 'Drop image here...' : 'Paste text or screenshot to capture...'}
          rows={isActive ? 4 : 2}
          className={`w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-ink
            placeholder-ink-3 resize-none outline-none transition-all
            ${isDragOver ? 'border-accent' : 'border-line focus:border-line-strong'}`}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-ink-3 truncate max-w-[120px]">{sourceLabel}</span>
            <input
              type="date"
              value={captureDate}
              onChange={(e) => setCaptureDate(e.target.value)}
              className="bg-transparent border border-line hover:border-line-strong focus:border-line-strong
                rounded px-1.5 py-0.5 text-xs text-ink-2 outline-none transition-colors cursor-pointer"
            />
          </div>
          {isActive && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => fileInputRef.current?.click()}
                className="text-ink-3 hover:text-ink-2 transition-colors text-xs" title="Attach screenshot">
                📎
              </button>
              <span className="text-xs text-ink-3">⌘↵</span>
              <button onClick={handleCapture} disabled={!hasContent}
                className="px-3 py-1 bg-accent hover:bg-accent-hover disabled:opacity-40
                  disabled:cursor-not-allowed text-white text-xs rounded-lg transition-colors font-medium">
                Capture
              </button>
            </div>
          )}
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
    </div>
  )
}
