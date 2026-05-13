import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import type { ResearchItem, Theme } from '@/types'

const MODEL = 'claude-sonnet-4-6'
const MAX_CONTENT_CHARS = 800

export interface ScanInputItem {
  id: number
  snippet: string
  notes: string
  sourceType: string
  sourceSender: string
  url: string
}

export interface ScanInputTheme {
  id: number
  name: string
  description: string
}

export interface RawProposal {
  name: string
  description: string
  supportingItemIds: number[]
}

export interface RawAssignment {
  itemId: number
  themeId: number
  confidence: number
}

export interface ScanResult {
  proposals: RawProposal[]
  assignments: RawAssignment[]
}

export class ScanError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ScanError'
  }
}

export function prepareItemsForScan(items: ResearchItem[]): ScanInputItem[] {
  return items.map((item) => ({
    id: item.id!,
    snippet: (item.rawContent || item.content).slice(0, MAX_CONTENT_CHARS),
    notes: item.notes ?? '',
    sourceType: item.sourceType,
    sourceSender: item.sourceSender ?? '',
    url: item.url ?? '',
  }))
}

export function estimateTokens(items: ScanInputItem[], themes: ScanInputTheme[]): number {
  const itemChars = items.reduce((n, i) => n + i.snippet.length + i.notes.length + 80, 0)
  const themeChars = themes.reduce((n, t) => n + t.name.length + t.description.length + 40, 0)
  return Math.ceil((itemChars + themeChars + 1500) / 3.5)
}

async function getApiKey(): Promise<string> {
  const row = await db.settings.get('anthropicApiKey')
  const key = row?.value?.trim()
  if (!key) throw new ScanError('No Anthropic API key set. Add one in Settings.')
  return key
}

const tool: Anthropic.Tool = {
  name: 'record_suggestions',
  description:
    'Record theme assignments for existing items and proposals for new themes. ' +
    'Only return items/themes whose IDs were given to you. Confidence is 0..1.',
  input_schema: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        description: 'Suggested tags from existing items to existing themes.',
        items: {
          type: 'object',
          properties: {
            itemId: { type: 'number' },
            themeId: { type: 'number' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['itemId', 'themeId', 'confidence'],
        },
      },
      proposals: {
        type: 'array',
        description: 'Proposed new themes that would cluster two or more items not well-covered by existing themes.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short, distinctive name (1-3 words).' },
            description: { type: 'string', description: 'One sentence describing what belongs here.' },
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

function buildPrompt(items: ScanInputItem[], themes: ScanInputTheme[]): string {
  const themesBlock = themes.length === 0
    ? '(no existing themes yet — focus entirely on proposing new ones)'
    : themes.map((t) =>
        `- id=${t.id} · ${t.name}${t.description ? ` — ${t.description}` : ''}`
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

  return [
    'You are organizing a personal research corpus. Two jobs:',
    '',
    '1. ASSIGN — for each item that clearly belongs in an existing theme, return an assignment. Be selective; confidence ≥ 0.6 only. Multiple themes per item are allowed.',
    '2. PROPOSE — when you see a recurring topic across 2+ items that no existing theme covers well, propose a new theme. Skip one-offs.',
    '',
    'Existing themes:',
    themesBlock,
    '',
    'Items to organize:',
    itemsBlock,
    '',
    'Call the record_suggestions tool with both arrays. If nothing fits a bucket, return an empty array for it.',
  ].join('\n')
}

export async function scanCorpus(
  items: ResearchItem[],
  themes: Theme[]
): Promise<ScanResult> {
  if (items.length === 0) {
    return { proposals: [], assignments: [] }
  }

  const apiKey = await getApiKey()
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const inputItems = prepareItemsForScan(items)
  const inputThemes: ScanInputTheme[] = themes.map((t) => ({
    id: t.id!,
    name: t.name,
    description: t.description ?? '',
  }))

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_suggestions' },
      messages: [{ role: 'user', content: buildPrompt(inputItems, inputThemes) }],
    })
  } catch (err) {
    throw new ScanError(
      err instanceof Error ? err.message : 'Anthropic API request failed',
      err
    )
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_suggestions'
  )
  if (!toolBlock) {
    throw new ScanError('Model did not return structured suggestions.')
  }

  const raw = toolBlock.input as Partial<ScanResult>
  const validItemIds = new Set(items.map((i) => i.id!))
  const validThemeIds = new Set(themes.map((t) => t.id!))

  const assignments = (raw.assignments ?? []).filter(
    (a) =>
      typeof a.itemId === 'number' && validItemIds.has(a.itemId) &&
      typeof a.themeId === 'number' && validThemeIds.has(a.themeId) &&
      typeof a.confidence === 'number'
  )

  const existingNames = new Set(themes.map((t) => t.name.trim().toLowerCase()))
  const proposals = (raw.proposals ?? []).filter((p) =>
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    !existingNames.has(p.name.trim().toLowerCase()) &&
    Array.isArray(p.supportingItemIds) &&
    p.supportingItemIds.filter((id) => validItemIds.has(id)).length >= 2
  ).map((p) => ({
    name: p.name.trim(),
    description: (p.description ?? '').trim(),
    supportingItemIds: p.supportingItemIds.filter((id) => validItemIds.has(id)),
  }))

  return { assignments, proposals }
}
