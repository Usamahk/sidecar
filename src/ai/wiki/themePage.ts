import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import type { ResearchItem, Theme } from '@/types'
import { getApiKey } from '@/ai/apiKey'
import { getModelForRole } from '@/ai/models'
import { sourceConceptIdFor } from '@/ai/resolve'
import { evidenceHashForTheme, itemsForTheme, recordBuilt } from '@/ai/freshness'
import { getVaultDoc } from '@/db/vaultDocs'
import { writeConcept, readConcept, conceptIdFor, rebuildIndex, appendLog } from '@/vault'

/**
 * Theme-page builder for the compounding wiki. A theme page is the *rolling,
 * cheap synthesis* of what a theme's captures collectively say (vs the deep,
 * researched insight dossier). On refresh it integrates only what changed since
 * the last build, preserving accumulated synthesis (Q11: lazy staleness +
 * incremental integration).
 */

export class ThemePageError extends Error {
  constructor(message: string, public readonly code: 'no_api_key' | 'no_items' | 'api' = 'api') {
    super(message)
    this.name = 'ThemePageError'
  }
}

const MAX_ITEMS = 40
const MAX_SNIPPET = 500

function itemLine(item: ResearchItem): string {
  const title = item.pageTitle || item.domain || `Item ${item.id}`
  const snippet = (item.rawContent || item.content || '').slice(0, MAX_SNIPPET).replace(/\s+/g, ' ').trim()
  const parts = [`<item id="${item.id}" title="${title}" source="/${sourceConceptIdFor(item)}.md">`]
  if (item.url) parts.push(`url: ${item.url}`)
  parts.push(snippet || '(no captured text)')
  if (item.notes?.trim()) parts.push(`notes: ${item.notes.trim()}`)
  parts.push('</item>')
  return parts.join('\n')
}

function fullSystem(): string {
  return [
    "You are Sidecar's wiki maintainer. Write a Theme page: a coherent rolling synthesis",
    'of what a set of captured items collectively say about a theme — not a list of summaries.',
    'Structure with "## Overview", "## Key threads", "## Notable items", "## Open questions".',
    'Link items to their source concept with bundle-relative links exactly like',
    '[Title](/sources/slug-id.md) using the source paths given. Output only the Markdown page.',
  ].join('\n')
}

function incrementalSystem(): string {
  return [
    "You are Sidecar's wiki maintainer. You are given an EXISTING theme page and a set of",
    'NEW or UPDATED captures. Integrate the new material into the page: revise affected',
    'sections, add threads where warranted, and keep the synthesis coherent — do not just',
    'append. If new material contradicts existing claims, note it under a "## Contradictions"',
    'section. Preserve the existing structure and prior synthesis. Link items to their source',
    'with [Title](/sources/slug-id.md). Output the FULL updated Markdown page.',
  ].join('\n')
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export interface ThemePageOutcome {
  conceptId: string
  skipped?: boolean
}

/** Build or incrementally refresh the OKF theme page for a theme. */
export async function buildThemePage(themeId: number): Promise<ThemePageOutcome> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new ThemePageError('No Anthropic API key set. Add one in Settings.', 'no_api_key')

  const theme = await db.themes.get(themeId)
  if (!theme) throw new ThemePageError('Theme not found.', 'no_items')

  const allItems = await db.items.toArray()
  const themeItems = itemsForTheme(themeId, allItems)
  if (themeItems.length === 0) {
    throw new ThemePageError('This theme has no items yet — tag some first.', 'no_items')
  }

  const conceptId = conceptIdFor('themes', theme.name, themeId)
  const currentHash = evidenceHashForTheme(themeId, allItems)

  const [existing, vdoc] = await Promise.all([readConcept(conceptId), getVaultDoc(conceptId)])
  // Already fresh — nothing changed since the last build.
  if (existing && vdoc && vdoc.evidenceHash === currentHash) {
    return { conceptId, skipped: true }
  }

  const incremental = !!(existing && vdoc)
  const builtAt = vdoc?.builtAt ?? 0
  const corpus = incremental
    ? themeItems.filter((it) => it.updatedAt > builtAt)
    : [...themeItems].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS)
  // Edge case: incremental but no per-item delta (e.g. an item left the theme) —
  // fall back to a full rebuild so the page reflects the current set.
  const doFull = !incremental || corpus.length === 0
  const itemsForPrompt = doFull
    ? [...themeItems].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS)
    : corpus.slice(0, MAX_ITEMS)

  const model = await getModelForRole('synthesize')
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  const itemsBlock = itemsForPrompt.map(itemLine).join('\n\n')
  const system = doFull ? fullSystem() : incrementalSystem()
  const userContent = doFull
    ? `# Theme: ${theme.name}\n${theme.description ? theme.description + '\n' : ''}\n# Captures\n\n${itemsBlock}\n\nWrite the theme page.`
    : `# Theme: ${theme.name}\n\n# Existing page\n\n${existing!.body}\n\n# New or updated captures\n\n${itemsBlock}\n\nIntegrate and output the full updated page.`

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model,
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
  } catch (err) {
    throw new ThemePageError(err instanceof Error ? err.message : 'Theme-page synthesis failed', 'api')
  }

  const body = extractText(message)
  if (!body) throw new ThemePageError('The model returned an empty page.', 'api')

  await writeConcept({
    conceptId,
    type: 'Theme',
    title: theme.name,
    description: theme.description || undefined,
    tags: [theme.name],
    body,
  })
  await recordBuilt(conceptId, 'theme', themeId, currentHash)
  await rebuildIndex()
  await appendLog(existing ? 'Update' : 'Creation', `${existing ? 'Refreshed' : 'Built'} theme page [${theme.name}](/${conceptId}.md)`)

  return { conceptId }
}

export type { Theme }
