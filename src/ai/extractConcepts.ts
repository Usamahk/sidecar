import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import { getConceptRejections } from '@/db/suggestions'
import type { ResearchItem, Concept } from '@/types'

export const DEFAULT_CONCEPT_MODEL = 'claude-sonnet-4-6'
const MAX_CONTENT_CHARS = 800

export interface ExtractInputItem {
  id: number
  snippet: string
  notes: string
  sourceType: string
  sourceSender: string
  url: string
}

export interface ExtractInputConcept {
  id: number
  name: string
  description: string
}

export interface RawConceptProposal {
  name: string
  description: string
  supportingItemIds: number[]
}

export interface RawConceptAssignment {
  itemId: number
  conceptId: number
  confidence: number
}

export interface ExtractResult {
  proposals: RawConceptProposal[]
  assignments: RawConceptAssignment[]
}

export class ExtractError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ExtractError'
  }
}

export function prepareItemsForExtract(items: ResearchItem[]): ExtractInputItem[] {
  return items.map((item) => ({
    id: item.id!,
    snippet: (item.rawContent || item.content).slice(0, MAX_CONTENT_CHARS),
    notes: item.notes ?? '',
    sourceType: item.sourceType,
    sourceSender: item.sourceSender ?? '',
    url: item.url ?? '',
  }))
}

export function estimateConceptTokens(items: ExtractInputItem[], concepts: ExtractInputConcept[]): number {
  const itemChars = items.reduce((n, i) => n + i.snippet.length + i.notes.length + 80, 0)
  const conceptChars = concepts.reduce((n, c) => n + c.name.length + c.description.length + 40, 0)
  return Math.ceil((itemChars + conceptChars + 1800) / 3.5)
}

async function getApiKey(): Promise<string> {
  const row = await db.settings.get('anthropicApiKey')
  const key = row?.value?.trim()
  if (!key) throw new ExtractError('No Anthropic API key set. Add one in Settings.')
  return key
}

async function getConceptModel(): Promise<string> {
  const row = await db.settings.get('conceptModel')
  return row?.value?.trim() || DEFAULT_CONCEPT_MODEL
}

const tool: Anthropic.Tool = {
  name: 'record_concepts',
  description:
    'Record concept extractions across a research corpus. A concept is a named entity, person, ' +
    'product, place, technology, or recurring idea that surfaces in the user\'s captures. ' +
    'Concepts differ from themes: themes are broad clusters (e.g. "AI safety"); ' +
    'concepts are specific named things (e.g. "GPT-5", "Anthropic", "constitutional AI"). ' +
    'Only return items/concepts whose IDs were given to you. Confidence is 0..1.',
  input_schema: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        description: 'Tags from existing items to existing concepts. Confidence ≥ 0.6.',
        items: {
          type: 'object',
          properties: {
            itemId: { type: 'number' },
            conceptId: { type: 'number' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['itemId', 'conceptId', 'confidence'],
        },
      },
      proposals: {
        type: 'array',
        description: 'Newly observed concepts that recur across 2+ items and are not already in the existing list.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The canonical name of the concept (preserve casing).' },
            description: { type: 'string', description: 'One sentence describing what this concept is.' },
            supportingItemIds: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
            },
          },
          required: ['name', 'description', 'supportingItemIds'],
        },
      },
    },
    required: ['assignments', 'proposals'],
  },
}

interface ConceptRejectionContext {
  proposedNamesLower: string[]
  assignmentPairs: Array<[number, number]>
}

function buildPrompt(
  items: ExtractInputItem[],
  concepts: ExtractInputConcept[],
  rejections: ConceptRejectionContext
): string {
  const conceptsBlock = concepts.length === 0
    ? '(no existing concepts yet — focus on proposing new ones)'
    : concepts.map((c) =>
        `- id=${c.id} · ${c.name}${c.description ? ` — ${c.description}` : ''}`
      ).join('\n')

  const itemsBlock = items.map((i) => {
    const lines = [`<item id="${i.id}">`]
    if (i.sourceSender) lines.push(`from: ${i.sourceSender} (${i.sourceType})`)
    else lines.push(`source: ${i.sourceType}`)
    if (i.url) lines.push(`url: ${i.url}`)
    lines.push(i.snippet)
    if (i.notes) lines.push(`---notes--- ${i.notes}`)
    lines.push('</item>')
    return lines.join('\n')
  }).join('\n\n')

  const lines = [
    'You are extracting concepts from a personal research corpus. A concept is a specific named ' +
    'thing — a person, product, company, technology, paper, place, or distinct idea — that the user ' +
    'is tracking. Two jobs:',
    '',
    '1. ASSIGN — for each item that clearly references an existing concept, return an assignment. Be selective; confidence ≥ 0.6 only. Multiple concepts per item are allowed.',
    '2. PROPOSE — when you see a specific concept referenced across 2+ items that is not in the existing list, propose it. Skip one-offs. Skip broad themes (those belong elsewhere).',
    '',
    'Existing concepts:',
    conceptsBlock,
  ]

  if (rejections.proposedNamesLower.length > 0) {
    lines.push('')
    lines.push('Do NOT propose any of these concept names (the user previously rejected them):')
    lines.push(rejections.proposedNamesLower.map((n) => `- ${n}`).join('\n'))
  }

  if (rejections.assignmentPairs.length > 0) {
    lines.push('')
    lines.push('Do NOT suggest these specific item→concept assignments (the user rejected them):')
    lines.push(rejections.assignmentPairs.map(([i, c]) => `- item ${i} → concept ${c}`).join('\n'))
  }

  lines.push('')
  lines.push('Items to extract from:')
  lines.push(itemsBlock)
  lines.push('')
  lines.push('Call the record_concepts tool with both arrays. If nothing fits a bucket, return an empty array for it.')

  return lines.join('\n')
}

export async function extractConcepts(
  items: ResearchItem[],
  concepts: Concept[]
): Promise<ExtractResult> {
  if (items.length === 0) {
    return { proposals: [], assignments: [] }
  }

  const [apiKey, model, rejections] = await Promise.all([
    getApiKey(),
    getConceptModel(),
    getConceptRejections(),
  ])

  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const inputItems = prepareItemsForExtract(items)
  const inputConcepts: ExtractInputConcept[] = concepts.map((c) => ({
    id: c.id!,
    name: c.name,
    description: c.description ?? '',
  }))

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_concepts' },
      messages: [{ role: 'user', content: buildPrompt(inputItems, inputConcepts, rejections) }],
    })
  } catch (err) {
    throw new ExtractError(
      err instanceof Error ? err.message : 'Anthropic API request failed',
      err
    )
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_concepts'
  )
  if (!toolBlock) {
    throw new ExtractError('Model did not return structured concepts.')
  }

  const raw = toolBlock.input as Partial<ExtractResult>
  const validItemIds = new Set(items.map((i) => i.id!))
  const validConceptIds = new Set(concepts.map((c) => c.id!))

  const rejectedPairs = new Set(
    rejections.assignmentPairs.map(([i, c]) => `${i}:${c}`)
  )
  const rejectedNames = new Set(rejections.proposedNamesLower)

  const assignments = (raw.assignments ?? []).filter(
    (a) =>
      typeof a.itemId === 'number' && validItemIds.has(a.itemId) &&
      typeof a.conceptId === 'number' && validConceptIds.has(a.conceptId) &&
      typeof a.confidence === 'number' &&
      !rejectedPairs.has(`${a.itemId}:${a.conceptId}`)
  )

  const existingNames = new Set(concepts.map((c) => c.name.trim().toLowerCase()))
  const proposals = (raw.proposals ?? []).filter((p) => {
    if (typeof p.name !== 'string' || p.name.trim().length === 0) return false
    const nameLower = p.name.trim().toLowerCase()
    if (existingNames.has(nameLower)) return false
    if (rejectedNames.has(nameLower)) return false
    return Array.isArray(p.supportingItemIds) &&
      p.supportingItemIds.filter((id) => validItemIds.has(id)).length >= 2
  }).map((p) => ({
    name: p.name.trim(),
    description: (p.description ?? '').trim(),
    supportingItemIds: p.supportingItemIds.filter((id) => validItemIds.has(id)),
  }))

  return { assignments, proposals }
}
