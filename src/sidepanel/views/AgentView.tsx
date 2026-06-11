import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { addMessage, createConversation, deleteConversation } from '@/db/agent'
import { chatWithAgent, AgentChatError } from '@/ai/agent/chat'
import { Icons } from '../components/Icons'
import { getAgentPrefill, clearAgentPrefill } from '@/sidepanel/state/agentPrefill'
import type { AgentCitation, AgentResponseMode, AgentMessage } from '@/types'

export function AgentView() {
  const conversations = useLiveQuery(
    () => db.conversations.orderBy('updatedAt').reverse().toArray(),
    []
  )
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [useWeb, setUseWeb] = useState(false)
  const [mode, setMode] = useState<AgentResponseMode>('detailed')
  const [maxContextItems, setMaxContextItems] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [pendingAssistantId, setPendingAssistantId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const messages = useLiveQuery(
    () => activeConversationId == null
      ? Promise.resolve([] as AgentMessage[])
      : db.messages.where('conversationId').equals(activeConversationId).sortBy('createdAt'),
    [activeConversationId]
  )

  useEffect(() => {
    if (activeConversationId == null && conversations && conversations.length > 0) {
      setActiveConversationId(conversations[0].id!)
    }
  }, [conversations, activeConversationId])

  // Pick up a prefilled prompt from the graph view, if any.
  useEffect(() => {
    const pending = getAgentPrefill()
    if (pending) {
      setInput(pending)
      clearAgentPrefill()
    }
  }, [])

  useEffect(() => {
    db.settings.get('agentUseWebDefault').then((row) => {
      if (row?.value === 'true') setUseWeb(true)
    })
    db.settings.get('agentResponseMode').then((row) => {
      if (row?.value === 'concise' || row?.value === 'detailed') setMode(row.value)
    })
    db.settings.get('agentMaxContextItems').then((row) => {
      const n = Number(row?.value)
      if (!Number.isNaN(n) && n > 0 && n <= 12) setMaxContextItems(n)
    })
  }, [])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, isSending, pendingAssistantId])

  const canSend = input.trim().length > 0 && !isSending
  const showEmpty = !messages || messages.length === 0

  const activeTitle = useMemo(() => {
    if (!conversations || activeConversationId == null) return 'New chat'
    return conversations.find((c) => c.id === activeConversationId)?.title ?? 'New chat'
  }, [conversations, activeConversationId])

  async function handleNewConversation() {
    const id = await createConversation('')
    setActiveConversationId(id)
    setError(null)
  }

  async function handleDeleteConversation() {
    if (activeConversationId == null) return
    if (!confirm('Delete this conversation?')) return
    await deleteConversation(activeConversationId)
    setActiveConversationId(null)
  }

  async function persistAgentSettings(nextUseWeb: boolean, nextMode: AgentResponseMode, nextMax: number) {
    await Promise.all([
      db.settings.put({ key: 'agentUseWebDefault', value: String(nextUseWeb) }),
      db.settings.put({ key: 'agentResponseMode', value: nextMode }),
      db.settings.put({ key: 'agentMaxContextItems', value: String(nextMax) }),
    ])
  }

  async function handleSend() {
    const prompt = input.trim()
    if (!prompt || isSending) return
    setInput('')
    setError(null)
    setIsSending(true)
    await persistAgentSettings(useWeb, mode, maxContextItems)

    let conversationId = activeConversationId
    if (conversationId == null) {
      conversationId = await createConversation(prompt)
      setActiveConversationId(conversationId)
    }

    await addMessage({
      conversationId,
      role: 'user',
      content: prompt,
      usedWeb: false,
      model: '',
    })
    const history = await db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
    const placeholderId = await addMessage({
      conversationId,
      role: 'assistant',
      content: 'Thinking…',
      usedWeb: useWeb,
      model: '',
      citations: [],
    })
    setPendingAssistantId(placeholderId)
    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const result = await chatWithAgent({
        prompt,
        history,
        useWeb,
        mode,
        maxContextItems,
        signal: abortController.signal,
      })
      await db.messages.update(placeholderId, {
        content: result.content,
        citations: result.citations,
        model: result.model,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        await db.messages.update(placeholderId, { content: 'Stopped.', citations: [] })
      } else {
        const msg = err instanceof AgentChatError ? err.message
          : err instanceof Error ? err.message
          : 'Request failed'
        setError(msg)
        await db.messages.update(placeholderId, { content: `Error: ${msg}`, citations: [] })
      }
    } finally {
      abortRef.current = null
      setPendingAssistantId(null)
      setIsSending(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-line bg-surface-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-ink-3">Conversation</p>
            <p className="text-sm text-ink truncate font-medium">{activeTitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewConversation}
              className="text-xs px-2 py-1 border border-line rounded-lg text-ink-2 hover:border-line-strong"
            >
              New
            </button>
            <button
              onClick={handleDeleteConversation}
              disabled={activeConversationId == null}
              className="text-xs px-2 py-1 border border-line rounded-lg text-ink-3 hover:text-red-500 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ToggleChip
            label="Use web"
            active={useWeb}
            onClick={() => setUseWeb((v) => !v)}
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AgentResponseMode)}
            className="text-xs bg-surface-2 border border-line rounded-lg px-2 py-1 text-ink-2"
          >
            <option value="detailed">Detailed</option>
            <option value="concise">Concise</option>
          </select>
          <select
            value={maxContextItems}
            onChange={(e) => setMaxContextItems(Number(e.target.value))}
            className="text-xs bg-surface-2 border border-line rounded-lg px-2 py-1 text-ink-2"
          >
            <option value={4}>4 context</option>
            <option value={6}>6 context</option>
            <option value={8}>8 context</option>
            <option value={10}>10 context</option>
          </select>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {showEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-1.5">
            <div className="mb-2 text-ink-3"><Icons.agent size={48} stroke={1.4} /></div>
            <p className="font-serif text-[19px] text-ink m-0">Ask Sidecar about your research</p>
            <p className="text-xs text-ink-3 max-w-[240px] leading-relaxed m-0">Answers are grounded in captured items, with optional web context.</p>
          </div>
        ) : (
          messages!.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
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
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void handleSend()
              }
            }}
            rows={2}
            placeholder="Ask about your corpus…"
            className="flex-1 bg-surface-2 border border-line focus:border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-3 resize-none outline-none"
          />
          {isSending ? (
            <button
              onClick={handleStop}
              className="px-3 py-2 text-xs rounded-lg border border-line text-ink-2 hover:border-line-strong"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="px-3 py-2 text-xs rounded-lg bg-accent text-on-accent disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
        <p className="font-mono text-[10px] text-ink-3 mt-1">⌘↵ / Ctrl↵ to send</p>
      </div>
    </div>
  )
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-accent/15 border-accent text-accent'
          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
      }`}
    >
      {label}
    </button>
  )
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-xl border px-3 py-2 ${
        isUser
          ? 'bg-accent/10 border-accent/30'
          : 'bg-surface-1 border-line'
      }`}>
        <p className="text-[10px] text-ink-3 mb-1">
          {isUser ? 'You' : 'Agent'}
          {!isUser && message.model ? ` · ${message.model}` : ''}
          {!isUser && message.usedWeb ? ' · web enabled' : ''}
        </p>
        <p className="text-sm text-ink whitespace-pre-wrap">{message.content}</p>
        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-line space-y-1.5">
            {message.citations.map((c) => (
              <CitationRow key={`${message.id}-${c.refId}`} citation={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CitationRow({ citation }: { citation: AgentCitation }) {
  return (
    <div className="text-xs rounded-lg bg-surface-2 border border-line px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-[10px] text-ink-3">{citation.refId}</span>
        {citation.url && (
          <button
            onClick={() => chrome.tabs.create({ url: citation.url! })}
            className="text-[10px] text-accent hover:opacity-80"
          >
            open
          </button>
        )}
      </div>
      <p className="text-ink-2 font-medium truncate">{citation.title}</p>
      <p className="text-ink-3">{citation.snippet}</p>
    </div>
  )
}
