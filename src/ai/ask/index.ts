import type Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from '@/ai/apiKey'
import { getModelForRole, estimateCostUsd, type TokenUsage } from '@/ai/models'
import { readConcept, readIndex, writeConcept, slugify, conceptExists, rebuildIndex, appendLog } from '@/vault'

/**
 * Wiki-grounded Q&A — the reborn chat. Unlike the retired RAG chat (which
 * re-derived from raw snippets every turn), this reasons over the *accumulated*
 * OKF vault: it reads index.md, drills into relevant concepts via a bounded
 * read_concept tool loop, and answers grounded only in what it opened. Good
 * answers can be filed back into the vault so explorations compound too.
 */

export class AskError extends Error {
  constructor(message: string, public readonly code: 'no_api_key' | 'empty_vault' | 'api' = 'api') {
    super(message)
    this.name = 'AskError'
  }
}

export interface AskTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskResult {
  answer: string
  citedConceptIds: string[]
  costUsd: number
}

const MAX_READ_STEPS = 6
const MAX_HISTORY = 6

const readConceptTool = {
  name: 'read_concept',
  description:
    'Open a concept from the knowledge bundle by its concept id (the path shown in the index without the .md suffix, e.g. "insights/foo-3"). Returns the page contents.',
  input_schema: {
    type: 'object',
    properties: {
      conceptId: { type: 'string', description: 'Concept id from the index, without the leading slash or .md suffix.' },
    },
    required: ['conceptId'],
  },
}

function systemPrompt(index: string): string {
  return [
    "You answer questions using ONLY the user's personal knowledge bundle (an OKF markdown wiki).",
    'You are given the bundle index below. Use the read_concept tool to open the pages most',
    'relevant to the question before answering — prefer insight dossiers and theme pages, then',
    'sources. Do not answer from outside knowledge; if the bundle does not cover the question,',
    'say so plainly.',
    'Cite every page you used inline with bundle-relative links exactly like',
    '[Title](/insights/foo-3.md). Be concise and concrete.',
    '',
    '=== Bundle index ===',
    index,
  ].join('\n')
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function citedFrom(answer: string): string[] {
  const ids = new Set<string>()
  const re = /\]\(\/([^)]+?)\.md\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(answer)) !== null) ids.add(m[1])
  return [...ids]
}

/** Answer a question grounded in the OKF vault, drilling in via read_concept. */
export async function askVault(question: string, history: AskTurn[] = []): Promise<AskResult> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new AskError('No Anthropic API key set. Add one in Settings.', 'no_api_key')

  const index = await readIndex()
  if (!index || !index.trim()) {
    throw new AskError('The wiki is empty — build a dossier or theme page first.', 'empty_vault')
  }

  const model = await getModelForRole('research')
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const priorTurns: Anthropic.MessageParam[] = history
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content }))

  const messages: Anthropic.MessageParam[] = [...priorTurns, { role: 'user', content: question }]

  let costUsd = 0
  let answer = ''
  try {
    for (let step = 0; step < MAX_READ_STEPS; step++) {
      const resp = await client.messages.create({
        model,
        max_tokens: 4000,
        system: systemPrompt(index),
        tools: [readConceptTool] as any,
        messages,
      })
      costUsd += estimateCostUsd(model, resp.usage as TokenUsage)

      if (resp.stop_reason === 'tool_use') {
        const toolUses = resp.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        )
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          const conceptId = String((tu.input as any)?.conceptId ?? '').replace(/^\/+/, '').replace(/\.md$/, '')
          const concept = conceptId ? await readConcept(conceptId) : null
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: concept
              ? `# ${concept.title ?? conceptId}\n\n${concept.body}`
              : `Concept "${conceptId}" not found in the bundle.`,
          })
        }
        messages.push({ role: 'assistant', content: resp.content })
        messages.push({ role: 'user', content: results })
        continue
      }

      answer = extractText(resp)
      break
    }
  } catch (err) {
    throw new AskError(err instanceof Error ? err.message : 'Q&A request failed', 'api')
  }

  if (!answer) {
    answer = 'I opened the most relevant pages but could not compose an answer. Try rephrasing.'
  }
  return { answer, citedConceptIds: citedFrom(answer), costUsd }
}

/** File a good answer back into the vault as a durable Q&A note. */
export async function fileAnswer(question: string, answer: string): Promise<string> {
  const conceptId = `notes/${slugify(question).slice(0, 48)}-${Date.now().toString(36)}`
  const existed = await conceptExists(conceptId)
  await writeConcept({
    conceptId,
    type: 'Q&A Note',
    title: question.slice(0, 120),
    description: 'Filed from a wiki Q&A',
    body: `# Question\n\n${question}\n\n# Answer\n\n${answer}`,
  })
  await rebuildIndex()
  await appendLog(existed ? 'Update' : 'Creation', `Filed Q&A note [${question.slice(0, 60)}](/${conceptId}.md)`)
  return conceptId
}
