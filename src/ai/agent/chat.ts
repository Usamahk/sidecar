import { db } from '@/db/schema'
import { DEFAULT_SCAN_MODEL } from '@/ai/scan'
import type { AgentCitation, AgentMessage, AgentResponseMode } from '@/types'
import { retrieveCorpusContext } from './retrieval'
import { fetchWebContext } from './web'
import type Anthropic from '@anthropic-ai/sdk'

const DEFAULT_AGENT_MODEL = 'claude-opus-4-7'

export class AgentChatError extends Error {
  constructor(
    message: string,
    public readonly code: 'no_api_key' | 'network' | 'rate_limit' | 'api' | 'unknown',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AgentChatError'
  }
}

interface ChatWithAgentInput {
  prompt: string
  history: AgentMessage[]
  useWeb: boolean
  mode: AgentResponseMode
  maxContextItems: number
  signal?: AbortSignal
}

interface ChatWithAgentResult {
  content: string
  citations: AgentCitation[]
  model: string
}

function joinContextLines(lines: string[]): string {
  return lines.filter(Boolean).join('\n')
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function parseUsedRefs(content: string): { cleaned: string; refs: Set<string> } {
  const match = content.match(/USED_SOURCES:\s*([A-Z0-9,\s]+)/i)
  if (!match) return { cleaned: content.trim(), refs: new Set() }
  const refs = new Set(
    match[1]
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )
  return {
    cleaned: content.replace(match[0], '').trim(),
    refs,
  }
}

async function getApiKey(): Promise<string> {
  const row = await db.settings.get('anthropicApiKey')
  const key = row?.value?.trim()
  if (!key) {
    throw new AgentChatError('No Anthropic API key set. Add one in Settings.', 'no_api_key')
  }
  return key
}

async function getModel(): Promise<string> {
  const agentModel = (await db.settings.get('agentModel'))?.value?.trim()
  if (agentModel) return agentModel
  const scanModel = (await db.settings.get('scanModel'))?.value?.trim()
  return scanModel || DEFAULT_AGENT_MODEL || DEFAULT_SCAN_MODEL
}

function toApiHistory(history: AgentMessage[]): Anthropic.MessageParam[] {
  const maxHistory = history.slice(-10)
  return maxHistory.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}

function buildContextBlock(citations: AgentCitation[]): string {
  if (citations.length === 0) return 'No relevant context was found in the local corpus.'
  return citations.map((c) => {
    const source = c.kind === 'item'
      ? `Sidecar item${c.domain ? ` · ${c.domain}` : ''}${c.date ? ` · ${c.date}` : ''}`
      : 'Web source'
    return `[${c.refId}] ${c.title}\nsource: ${source}${c.url ? `\nurl: ${c.url}` : ''}\nsnippet: ${c.snippet}`
  }).join('\n\n')
}

export async function chatWithAgent(input: ChatWithAgentInput): Promise<ChatWithAgentResult> {
  const [apiKey, model, corpusHits] = await Promise.all([
    getApiKey(),
    getModel(),
    retrieveCorpusContext(input.prompt, Math.max(1, input.maxContextItems)),
  ])
  const webHits = input.useWeb ? await fetchWebContext(input.prompt, 3) : []
  const allCitations = [...corpusHits.map((h) => h.citation), ...webHits.map((h) => h.citation)]
  const context = buildContextBlock(allCitations)

  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const detailInstruction = input.mode === 'concise'
    ? 'Keep the answer compact (3-6 bullets or one short paragraph).'
    : 'Provide a complete answer with clear structure and practical details.'

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      cache_control: { type: 'ephemeral' } as any,
      system: [{
        type: 'text',
        text: joinContextLines([
          'You are Sidecar, a research assistant grounded in provided context.',
          'Rules:',
          '- Use the supplied context blocks first.',
          '- If context is insufficient, say so briefly.',
          '- Cite source refs inline like [S12] or [W2] for factual claims.',
          `- ${detailInstruction}`,
          '- End your answer with exactly one line in this format:',
          'USED_SOURCES: S1, W1',
        ]),
        cache_control: { type: 'ephemeral' },
      }] as any,
      messages: [
        ...toApiHistory(input.history),
        {
          role: 'user',
          content: joinContextLines([
            `Question: ${input.prompt}`,
            '',
            'Context blocks:',
            context,
          ]),
        },
      ],
      signal: input.signal,
    } as any)
    const text = extractText(response)
    const parsed = parseUsedRefs(text)
    const used = parsed.refs.size > 0
      ? allCitations.filter((c) => parsed.refs.has(c.refId.toUpperCase()))
      : allCitations.slice(0, Math.min(4, allCitations.length))
    return {
      content: parsed.cleaned,
      citations: used,
      model,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent request failed'
    if (message.includes('429') || message.toLowerCase().includes('rate')) {
      throw new AgentChatError('Rate limit reached. Please retry in a moment.', 'rate_limit', err)
    }
    if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
      throw new AgentChatError('Network error while contacting Anthropic.', 'network', err)
    }
    throw new AgentChatError(message, 'api', err)
  }
}
