import { useRef, useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { askVault, fileAnswer, AskError, type AskTurn } from '@/ai/ask'
import { formatUsd } from '@/ai/models'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  cost?: number
  question?: string
  saved?: boolean
}

export function AskPanel() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending])

  async function send() {
    const q = input.trim()
    if (!q || sending) return
    const history: AskTurn[] = messages.map((m) => ({ role: m.role, content: m.content }))
    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setSending(true)
    try {
      const res = await askVault(q, history)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, cost: res.costUsd, question: q }])
    } catch (err) {
      setError(err instanceof AskError ? err.message : err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setSending(false)
    }
  }

  async function save(idx: number) {
    const m = messages[idx]
    if (!m?.question || savingIdx !== null) return
    setSavingIdx(idx)
    try {
      await fileAnswer(m.question, m.content)
      setMessages((prev) => prev.map((x, i) => (i === idx ? { ...x, saved: true } : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingIdx(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-ink-3 leading-relaxed">
            Ask a question about your research. Answers are grounded in your built wiki — dossiers,
            theme pages, and sources — with citations. Save good answers back to the wiki.
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[90%] rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed
                prose-p:my-1 prose-headings:text-ink prose-a:text-accent prose-code:text-accent">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      const isWeb = !!href && /^https?:/.test(href)
                      return (
                        <a
                          href={href}
                          title={href}
                          onClick={(e) => { e.preventDefault(); if (isWeb) chrome.tabs.create({ url: href! }) }}
                          className={isWeb ? 'text-accent underline cursor-pointer hover:opacity-80' : 'text-accent'}
                        >
                          {children}
                        </a>
                      )
                    },
                  }}
                >{m.content}</ReactMarkdown>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-ink-3">
                {m.cost != null && m.cost > 0 && <span className="tabular-nums">{formatUsd(m.cost)}</span>}
                <button
                  onClick={() => save(i)}
                  disabled={m.saved || savingIdx !== null}
                  className="ml-auto text-accent hover:opacity-80 disabled:opacity-50"
                >
                  {m.saved ? 'Saved to wiki ✓' : savingIdx === i ? 'Saving…' : 'Save to wiki'}
                </button>
              </div>
            </div>
          )
        )}

        {sending && <div className="text-xs text-ink-3 flex items-center gap-2"><span className="animate-spin">⟳</span> Reading the wiki…</div>}
      </div>

      {error && (
        <div className="px-3 pb-1">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}

      <div className="p-3 border-t border-line bg-surface-1">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() }
            }}
            rows={2}
            placeholder="Ask your wiki…"
            className="flex-1 bg-surface-2 border border-line focus:border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-3 resize-none outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="px-3 py-2 text-xs rounded-lg bg-accent text-on-accent disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        <p className="text-[10px] text-ink-3 mt-1">⌘↵ / Ctrl↵ to send</p>
      </div>
    </div>
  )
}
