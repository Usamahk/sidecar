import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import type { Insight, ResearchItem, Theme } from '@/types'
import { getApiKey } from '@/ai/apiKey'
import { getModelForRole, estimateCostUsd, type TokenUsage } from '@/ai/models'
import { ensureSourceConcept } from '@/ai/resolve'
import { evidenceHashForInsight, recordBuilt } from '@/ai/freshness'
import { writeConcept, conceptExists, conceptIdFor, rebuildIndex, appendLog } from '@/vault'
import {
  startBuild,
  setBuildStep,
  addResolvedItems,
  updateBuild,
  failBuild,
} from '@/db/builds'

/**
 * The research builder: insight -> OKF dossier. Hybrid orchestration — code
 * owns the macro pipeline (gather -> resolve -> research/synthesize -> write)
 * for predictable progress and cost; the research depth is delegated to a
 * bounded server-side web_search loop inside a single synthesis call.
 */

export class BuildError extends Error {
  constructor(message: string, public readonly code: 'no_api_key' | 'no_vault' | 'api' | 'unknown' = 'unknown') {
    super(message)
    this.name = 'BuildError'
  }
}

const MAX_ITEMS = 20
const MAX_SOURCE_CHARS = 2000
const WEB_SEARCH_MAX_USES = 4

interface GatherResult {
  insight: Insight
  themes: Theme[]
  themeNames: string[]
  items: ResearchItem[]
  evidenceHash: string
}

async function gather(insightId: number): Promise<GatherResult> {
  const insight = await db.insights.get(insightId)
  if (!insight) throw new BuildError('Insight not found.', 'unknown')

  const [allThemes, allItems] = await Promise.all([db.themes.toArray(), db.items.toArray()])
  const themeIdSet = new Set(insight.themeIds)
  const themes = allThemes.filter((t: Theme) => t.id != null && themeIdSet.has(t.id))
  const themeNames = themes.map((t: Theme) => t.name)

  const insightItemIds = new Set(insight.itemIds)
  const relevant = allItems.filter(
    (it: ResearchItem) =>
      it.id != null && (insightItemIds.has(it.id) || (it.themeIds ?? []).some((id: number) => themeIdSet.has(id)))
  )
  // Prioritise items the insight names, then the rest by recency; cap for cost.
  relevant.sort((a: ResearchItem, b: ResearchItem) => {
    const aNamed = insightItemIds.has(a.id!) ? 1 : 0
    const bNamed = insightItemIds.has(b.id!) ? 1 : 0
    if (aNamed !== bNamed) return bNamed - aNamed
    return b.createdAt - a.createdAt
  })
  return {
    insight,
    themes,
    themeNames,
    items: relevant.slice(0, MAX_ITEMS),
    evidenceHash: evidenceHashForInsight(insight, allItems),
  }
}

interface ResolvedRef {
  item: ResearchItem
  conceptId: string
  needsWeb: boolean
  excerpt: string
}

async function resolveAll(
  buildId: number,
  items: ResearchItem[],
  themeNames: string[]
): Promise<ResolvedRef[]> {
  const refs: ResolvedRef[] = []
  for (const item of items) {
    const ensured = await ensureSourceConcept(item, themeNames)
    const excerpt = (item.rawContent || item.content || '').slice(0, MAX_SOURCE_CHARS)
    refs.push({ item, conceptId: ensured.conceptId, needsWeb: ensured.needsWeb, excerpt })
    await addResolvedItems(buildId, [item.id!])
  }
  return refs
}

function buildSystemPrompt(): string {
  return [
    "You are Sidecar's research builder. You write a rigorous, well-structured research",
    'dossier in Markdown about a single insight, grounded in the user\'s captured sources.',
    '',
    'Rules:',
    '- Ground claims in the provided sources. Reference them with bundle-relative links',
    '  exactly like [Source Title](/sources/slug-id.md) using the ids given to you.',
    '- Use web_search when sources are thin (flagged "needs web"), or you need current or',
    '  primary information. Stay focused on the insight; do not wander.',
    '- Never invent sources or citations. Cite web sources under a final "# Citations"',
    '  section with their URLs.',
    '- Structure the dossier with these headings: "## Thesis", "## Evidence",',
    '  "## Deeper findings", "## Contradictions & open questions", then "# Citations".',
    '- Be concrete and analytical, not a summary dump. Output only the Markdown dossier.',
  ].join('\n')
}

function buildUserPrompt(g: GatherResult, refs: ResolvedRef[]): string {
  const lines: string[] = [
    `# Insight\n${g.insight.headline}`,
    g.insight.rationale ? `\nRationale: ${g.insight.rationale}` : '',
    g.themeNames.length ? `\nThemes: ${g.themeNames.join(', ')}` : '',
    '\n# Sources\n',
  ]
  for (const ref of refs) {
    lines.push(`<source id="${ref.conceptId}" title="${ref.item.pageTitle || ref.item.domain || 'Source'}"${ref.needsWeb ? ' needs-web="true"' : ''}>`)
    if (ref.item.url) lines.push(`url: ${ref.item.url}`)
    lines.push(ref.excerpt || '(no captured text)')
    lines.push('</source>\n')
  }
  lines.push('\nWrite the dossier now.')
  return lines.filter(Boolean).join('\n')
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

async function synthesize(
  buildId: number,
  g: GatherResult,
  refs: ResolvedRef[]
): Promise<{ body: string; costUsd: number }> {
  const [apiKey, model] = await Promise.all([getApiKey(), getModelForRole('synthesize')])
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const system = buildSystemPrompt()
  const userPrompt = buildUserPrompt(g, refs)
  const webSearchTool = { type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES }

  const request: any = {
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  }

  let message: Anthropic.Message
  try {
    message = await client.messages.create({ ...request, tools: [webSearchTool] })
  } catch (err) {
    // Account may not have web_search enabled — retry once with local sources only.
    const msg = err instanceof Error ? err.message : String(err)
    if (/tool|web_search|not.*enabled|invalid/i.test(msg)) {
      message = await client.messages.create(request)
    } else {
      throw new BuildError(msg, 'api')
    }
  }

  const body = extractText(message)
  const costUsd = estimateCostUsd(model, message.usage as TokenUsage)
  return { body, costUsd }
}

export interface BuildOutcome {
  buildId: number
  conceptId: string
}

/** Run (or resume) a research build for an insight, producing an OKF dossier. */
export async function buildDossier(insightId: number): Promise<BuildOutcome> {
  // Fail fast on missing prerequisites before creating a build row.
  if (!(await getApiKey())) {
    throw new BuildError('No Anthropic API key set. Add one in Settings.', 'no_api_key')
  }

  const buildId = await startBuild(insightId)
  try {
    const g = await gather(insightId)

    await setBuildStep(buildId, 'resolving', `Resolving ${g.items.length} sources…`)
    const refs = await resolveAll(buildId, g.items, g.themeNames)

    await setBuildStep(buildId, 'researching', 'Researching & synthesizing…')
    const { body, costUsd } = await synthesize(buildId, g, refs)
    if (!body) throw new BuildError('The model returned an empty dossier.', 'api')

    await setBuildStep(buildId, 'synthesizing', 'Writing dossier…')
    const conceptId = conceptIdFor('insights', g.insight.headline, insightId)
    const existed = await conceptExists(conceptId)
    await writeConcept({
      conceptId,
      type: 'Insight',
      title: g.insight.headline,
      description: g.insight.rationale || undefined,
      tags: g.themeNames,
      body,
    })

    await recordBuilt(conceptId, 'insight', insightId, g.evidenceHash)
    await rebuildIndex()
    await appendLog(existed ? 'Update' : 'Creation', `${existed ? 'Rebuilt' : 'Built'} dossier [${g.insight.headline}](/${conceptId}.md)`)

    await updateBuild(buildId, {
      status: 'done',
      step: 'Done',
      dossierConceptId: conceptId,
      costUsd,
    })
    return { buildId, conceptId }
  } catch (err) {
    const message =
      err instanceof BuildError ? err.message : err instanceof Error ? err.message : 'Build failed'
    await failBuild(buildId, message)
    throw err instanceof BuildError ? err : new BuildError(message)
  }
}
