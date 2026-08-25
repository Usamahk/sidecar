import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import { getRejections } from '@/db/suggestions'
import type { ResearchItem, Theme } from '@/types'
import { DEFAULT_ROLE_MODEL } from './models'
import { getApiKey as readApiKey } from './apiKey'

export const DEFAULT_SCAN_MODEL = DEFAULT_ROLE_MODEL.scan
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
  const key = await readApiKey()
  if (!key) throw new ScanError('No Anthropic API key set. Add one in Settings.')
  return key
}

async function getScanModel(): Promise<string> {
  const row = await db.settings.get('scanModel')
  return row?.value?.trim() || DEFAULT_SCAN_MODEL
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

interface RejectionContext {
  proposedNamesLower: string[]
  assignmentPairs: Array<[number, number]>
}

function buildPrompt(
  items: ScanInputItem[],
  themes: ScanInputTheme[],
  rejections: RejectionContext
): string {
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

  const lines = [
    'You are organizing a personal research corpus. Two jobs:',
    '',
    '1. ASSIGN — for each item that clearly belongs in an existing theme, return an assignment. Be selective; confidence ≥ 0.6 only. Multiple themes per item are allowed.',
    '2. PROPOSE — when you see a recurring topic across 2+ items that no existing theme covers well, propose a new theme. Skip one-offs.',
    '',
    'Existing themes:',
    themesBlock,
  ]

  if (rejections.proposedNamesLower.length > 0) {
    lines.push('')
    lines.push('Do NOT propose any of these theme names (the user previously rejected them):')
    lines.push(rejections.proposedNamesLower.map((n) => `- ${n}`).join('\n'))
  }

  if (rejections.assignmentPairs.length > 0) {
    lines.push('')
    lines.push('Do NOT suggest these specific item→theme assignments (the user rejected them):')
    lines.push(rejections.assignmentPairs.map(([i, t]) => `- item ${i} → theme ${t}`).join('\n'))
  }

  lines.push('')
  lines.push('Items to organize:')
  lines.push(itemsBlock)
  lines.push('')
  lines.push('Call the record_suggestions tool with both arrays. If nothing fits a bucket, return an empty array for it.')

  return lines.join('\n')
}

export async function scanCorpus(
  items: ResearchItem[],
  themes: Theme[]
): Promise<ScanResult> {
  if (items.length === 0) {
    return { proposals: [], assignments: [] }
  }

  const [apiKey, model, rejections] = await Promise.all([
    getApiKey(),
    getScanModel(),
    getRejections(),
  ])

  // Dynamic import keeps the ~500KB SDK out of the initial side-panel bundle.
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const inputThemes: ScanInputTheme[] = themes.map((t) => ({
    id: t.id!,
    name: t.name,
    description: t.description ?? '',
  }))

  // Scan in small batches. A single call over a large corpus (100+ items, dozens
  // of themes) makes the model return an empty tool call; ~20-item batches keep
  // each prompt focused enough for the model to actually do the work.
  const BATCH_SIZE = 20
  const batches: ResearchItem[][] = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE))
  }

  const rawAssignments: RawAssignment[] = []
  const rawProposals: Array<{ name?: string; description?: string; supportingItemIds?: number[] }> = []

  for (const batch of batches) {
    const inputItems = prepareItemsForScan(batch)
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model,
        max_tokens: 8192,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'record_suggestions' },
        messages: [{ role: 'user', content: buildPrompt(inputItems, inputThemes, rejections) }],
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
    if (!toolBlock) continue
    const raw = toolBlock.input as Partial<ScanResult>
    if (Array.isArray(raw.assignments)) rawAssignments.push(...(raw.assignments as RawAssignment[]))
    if (Array.isArray(raw.proposals)) rawProposals.push(...(raw.proposals as typeof rawProposals))
  }

  const validItemIds = new Set(items.map((i) => i.id!))
  const validThemeIds = new Set(themes.map((t) => t.id!))
  const rejectedPairs = new Set(rejections.assignmentPairs.map(([i, t]) => `${i}:${t}`))
  const rejectedNames = new Set(rejections.proposedNamesLower)

  // Dedupe assignments across batches by (item, theme), keeping highest confidence.
  const byPair = new Map<string, RawAssignment>()
  for (const a of rawAssignments) {
    if (typeof a.itemId !== 'number' || !validItemIds.has(a.itemId)) continue
    if (typeof a.themeId !== 'number' || !validThemeIds.has(a.themeId)) continue
    if (typeof a.confidence !== 'number') continue
    if (rejectedPairs.has(`${a.itemId}:${a.themeId}`)) continue
    const key = `${a.itemId}:${a.themeId}`
    const prev = byPair.get(key)
    if (!prev || a.confidence > prev.confidence) byPair.set(key, a)
  }
  const assignments = [...byPair.values()]

  // Merge proposals across batches by name; union their supporting items.
  const existingNames = new Set(themes.map((t) => t.name.trim().toLowerCase()))
  const byName = new Map<string, { name: string; description: string; ids: Set<number> }>()
  for (const p of rawProposals) {
    if (typeof p.name !== 'string' || p.name.trim().length === 0) continue
    const nameLower = p.name.trim().toLowerCase()
    if (existingNames.has(nameLower) || rejectedNames.has(nameLower)) continue
    const entry = byName.get(nameLower) ?? { name: p.name.trim(), description: (p.description ?? '').trim(), ids: new Set<number>() }
    for (const id of (p.supportingItemIds ?? [])) if (validItemIds.has(id)) entry.ids.add(id)
    if (!entry.description && p.description) entry.description = p.description.trim()
    byName.set(nameLower, entry)
  }
  const proposals: RawProposal[] = [...byName.values()]
    .filter((p) => p.ids.size >= 2)
    .map((p) => ({ name: p.name, description: p.description, supportingItemIds: [...p.ids] }))

  return { assignments, proposals }
}
