import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import { getInsightRejections } from '@/db/suggestions'
import type { ResearchItem, Theme } from '@/types'
import { DEFAULT_ROLE_MODEL } from './models'
import { getApiKey as readApiKey } from './apiKey'

export const DEFAULT_INSIGHT_MODEL = DEFAULT_ROLE_MODEL.insight
const MAX_SNIPPET_CHARS = 280
const MAX_ITEMS_PER_THEME = 4
const COOCCUR_MIN_WEIGHT = 1

export interface InsightProposal {
  headline: string
  rationale: string
  themeIds: number[]
  itemIds: number[]
  strength: number
}

export interface InsightResult {
  proposals: InsightProposal[]
}

export class InsightError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'InsightError'
  }
}

async function getApiKey(): Promise<string> {
  const key = await readApiKey()
  if (!key) throw new InsightError('No Anthropic API key set. Add one in Settings.')
  return key
}

async function getInsightModel(): Promise<string> {
  const row = await db.settings.get('insightModel')
  return row?.value?.trim() || DEFAULT_INSIGHT_MODEL
}

interface ThemeContext {
  id: number
  name: string
  description: string
  itemIds: number[]
  sampleSnippets: Array<{ id: number; text: string }>
}

interface CooccurPair {
  a: number
  b: number
  sharedItemIds: number[]
}

export function buildThemeContexts(themes: Theme[], items: ResearchItem[]): ThemeContext[] {
  const byTheme = new Map<number, ResearchItem[]>()
  for (const item of items) {
    for (const tId of item.themeIds ?? []) {
      const arr = byTheme.get(tId) ?? []
      arr.push(item)
      byTheme.set(tId, arr)
    }
  }
  return themes.map((t) => {
    const themeItems = byTheme.get(t.id!) ?? []
    const sorted = [...themeItems].sort((a, b) => b.createdAt - a.createdAt)
    const sample = sorted.slice(0, MAX_ITEMS_PER_THEME).map((i) => ({
      id: i.id!,
      text: (i.rawContent || i.content).slice(0, MAX_SNIPPET_CHARS).replace(/\s+/g, ' ').trim(),
    }))
    return {
      id: t.id!,
      name: t.name,
      description: t.description ?? '',
      itemIds: themeItems.map((i) => i.id!),
      sampleSnippets: sample,
    }
  })
}

export function buildCooccurrencePairs(items: ResearchItem[]): CooccurPair[] {
  const map = new Map<string, { a: number; b: number; shared: Set<number> }>()
  for (const item of items) {
    const ids = (item.themeIds ?? []).slice().sort((a, b) => a - b)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}::${ids[j]}`
        const entry = map.get(key) ?? { a: ids[i], b: ids[j], shared: new Set<number>() }
        entry.shared.add(item.id!)
        map.set(key, entry)
      }
    }
  }
  return Array.from(map.values())
    .filter((p) => p.shared.size >= COOCCUR_MIN_WEIGHT)
    .map((p) => ({ a: p.a, b: p.b, sharedItemIds: Array.from(p.shared) }))
    .sort((a, b) => b.sharedItemIds.length - a.sharedItemIds.length)
}

export function estimateInsightTokens(themes: Theme[], items: ResearchItem[]): number {
  const themeContexts = buildThemeContexts(themes, items)
  const pairs = buildCooccurrencePairs(items)
  let chars = 2000 // base prompt
  for (const tc of themeContexts) {
    chars += tc.name.length + tc.description.length + 80
    for (const s of tc.sampleSnippets) chars += s.text.length + 30
  }
  for (const p of pairs) chars += 60
  return Math.ceil(chars / 3.5)
}

const tool: Anthropic.Tool = {
  name: 'record_insights',
  description:
    'Record emergent insights from a personal research corpus. An insight is a short, ' +
    'punchy claim about a pattern or thread the user appears to be tracking — surfaced ' +
    'by looking ACROSS themes rather than at one theme in isolation. ' +
    'Examples of good insights: "Rise of robotics-startup chatter", ' +
    '"Convergence of biotech and AI safety discussions", "Recurring focus on long-context ' +
    'evaluation benchmarks". Bad insights are restatements of theme names, single-item ' +
    'observations, or generic platitudes. Only return ids you were given.',
  input_schema: {
    type: 'object',
    properties: {
      proposals: {
        type: 'array',
        description: 'Cross-theme pattern observations. 0–8 well-grounded insights, not noise.',
        items: {
          type: 'object',
          properties: {
            headline: {
              type: 'string',
              description: 'A 4–10 word claim. Concrete and specific. No theme-restating.',
            },
            rationale: {
              type: 'string',
              description: '1–2 sentences explaining what threads make this pattern visible.',
            },
            themeIds: {
              type: 'array',
              description: 'IDs of the themes whose interplay surfaces this insight. Usually 2–4.',
              items: { type: 'number' },
              minItems: 1,
            },
            itemIds: {
              type: 'array',
              description: 'IDs of items that ground the insight in real evidence. 1–8.',
              items: { type: 'number' },
              minItems: 1,
            },
            strength: {
              type: 'number',
              description: 'How robust the pattern feels (0..1). Below 0.4 = speculative.',
              minimum: 0,
              maximum: 1,
            },
          },
          required: ['headline', 'rationale', 'themeIds', 'itemIds', 'strength'],
        },
      },
    },
    required: ['proposals'],
  },
}

function buildPrompt(
  themes: ThemeContext[],
  pairs: CooccurPair[],
  rejectedHeadlines: string[]
): string {
  const themesBlock = themes.map((t) => {
    const lines = [`<theme id="${t.id}" name="${t.name}" items="${t.itemIds.length}">`]
    if (t.description) lines.push(`  desc: ${t.description}`)
    for (const s of t.sampleSnippets) lines.push(`  · item ${s.id}: ${s.text}`)
    lines.push(`</theme>`)
    return lines.join('\n')
  }).join('\n\n')

  const pairsBlock = pairs.length === 0
    ? '(no themes co-occur on any item)'
    : pairs.slice(0, 30).map((p) =>
        `themes ${p.a} ∩ ${p.b} → ${p.sharedItemIds.length} shared item${p.sharedItemIds.length !== 1 ? 's' : ''}: [${p.sharedItemIds.slice(0, 12).join(', ')}]`
      ).join('\n')

  const lines = [
    'You are surfacing emergent insights from a personal research corpus. Each item the user',
    'captured is tagged with one or more themes. Your job is to notice cross-theme patterns —',
    'threads building across multiple buckets that suggest the user is tracking an emerging trend.',
    '',
    'A good insight is a short, opinionated claim ("Rise of robotics-startup chatter",',
    '"Long-context benchmarks becoming the new frontier"). It is grounded in 2+ themes and',
    'concrete items. It is NOT a restatement of a theme name; it is NOT a single-item observation.',
    '',
    'Be selective. 0–8 insights total. Empty array is fine if nothing emerges.',
    '',
    '=== Themes (with sample items) ===',
    themesBlock,
    '',
    '=== Theme co-occurrence (items that carry both themes) ===',
    pairsBlock,
  ]

  if (rejectedHeadlines.length > 0) {
    lines.push('')
    lines.push('=== Do NOT re-propose these headlines (the user rejected them) ===')
    lines.push(rejectedHeadlines.map((h) => `- ${h}`).join('\n'))
  }

  lines.push('')
  lines.push('Call the record_insights tool. Return only insights you can defend from the evidence.')
  return lines.join('\n')
}

export async function surfaceInsights(
  items: ResearchItem[],
  themes: Theme[]
): Promise<InsightResult> {
  if (themes.length === 0) {
    throw new InsightError('No themes yet — tag some items with themes first.')
  }
  if (items.length === 0) {
    return { proposals: [] }
  }

  const [apiKey, model, rejections] = await Promise.all([
    getApiKey(),
    getInsightModel(),
    getInsightRejections(),
  ])

  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const themeContexts = buildThemeContexts(themes, items)
  const pairs = buildCooccurrencePairs(items)

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'record_insights' },
      messages: [{
        role: 'user',
        content: buildPrompt(themeContexts, pairs, rejections.proposedNamesLower),
      }],
    })
  } catch (err) {
    throw new InsightError(
      err instanceof Error ? err.message : 'Anthropic API request failed',
      err
    )
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_insights'
  )
  if (!toolBlock) {
    throw new InsightError('Model did not return structured insights.')
  }

  const raw = toolBlock.input as Partial<InsightResult>
  const validItemIds = new Set(items.map((i) => i.id!))
  const validThemeIds = new Set(themes.map((t) => t.id!))
  const rejectedLower = new Set(rejections.proposedNamesLower)

  const proposals: InsightProposal[] = (raw.proposals ?? [])
    .filter((p) =>
      typeof p.headline === 'string' && p.headline.trim().length > 0 &&
      !rejectedLower.has(p.headline.trim().toLowerCase()) &&
      Array.isArray(p.themeIds) && p.themeIds.length >= 1 &&
      Array.isArray(p.itemIds) && p.itemIds.length >= 1 &&
      typeof p.strength === 'number'
    )
    .map((p) => ({
      headline: p.headline.trim(),
      rationale: (p.rationale ?? '').trim(),
      themeIds: p.themeIds.filter((id: number) => validThemeIds.has(id)),
      itemIds: p.itemIds.filter((id: number) => validItemIds.has(id)),
      strength: Math.max(0, Math.min(1, p.strength)),
    }))
    .filter((p) => p.themeIds.length >= 1 && p.itemIds.length >= 1)

  return { proposals }
}
