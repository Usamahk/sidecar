import type { ResearchItem, SourceMethod, SourceType } from '@/types'
import { conceptIdFor, conceptExists, writeConcept } from '@/vault'
import { getSourceCache, putSourceCache, isFresh } from '@/db/sourceCache'

/**
 * Source resolver: lazily turns a captured item into the best available source
 * text at build time. Source-aware (Q3): newsletters use the pasted snippet as
 * the seed (the email body is noise); articles are fetched + extracted; Reddit
 * uses its per-thread JSON; Twitter/X can't be fetched (login wall) so falls
 * back to the snippet. The pasted snippet is always preserved as the intent
 * anchor, and every path falls back to it on failure.
 */

export interface ResolvedSource {
  text: string
  method: SourceMethod
  /** Resolver couldn't get full text — the research stage should web-search. */
  needsWeb: boolean
}

const FETCH_TIMEOUT_MS = 12_000
const MIN_USEFUL_CHARS = 600

function snippetOf(item: ResearchItem): string {
  return (item.rawContent || item.content || '').trim()
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function extractReadable(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg,iframe').forEach((el) => el.remove())
    const root = doc.querySelector('article') || doc.querySelector('main') || doc.body
    const text = root?.textContent ?? ''
    return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return ''
  }
}

async function resolveReddit(item: ResearchItem): Promise<ResolvedSource | null> {
  const jsonUrl = item.url.replace(/\/+$/, '') + '.json'
  const resp = await fetchWithTimeout(jsonUrl)
  if (!resp || !resp.ok) return null
  try {
    const data = await resp.json()
    const post = data?.[0]?.data?.children?.[0]?.data
    const comments = data?.[1]?.data?.children ?? []
    if (!post) return null
    const parts = [post.title, post.selftext].filter(Boolean)
    const topComments = comments
      .map((c: any) => c?.data?.body)
      .filter((b: any) => typeof b === 'string' && b.length > 0)
      .slice(0, 8)
    if (topComments.length) parts.push('--- Comments ---', ...topComments)
    const text = parts.join('\n\n').trim()
    return text ? { text, method: 'reddit-json', needsWeb: false } : null
  } catch {
    return null
  }
}

async function resolveArticle(item: ResearchItem): Promise<ResolvedSource | null> {
  const resp = await fetchWithTimeout(item.url)
  if (!resp || !resp.ok) return null
  const ctype = resp.headers.get('content-type') ?? ''
  if (!ctype.includes('text/html') && !ctype.includes('text/plain')) return null
  const html = await resp.text().catch(() => '')
  if (!html) return null
  const text = extractReadable(html)
  if (text.length < MIN_USEFUL_CHARS) return null
  return { text, method: 'fetch', needsWeb: false }
}

export async function resolveSource(item: ResearchItem): Promise<ResolvedSource> {
  const snippet = snippetOf(item)
  const fallback: ResolvedSource = {
    text: snippet,
    method: 'snippet',
    // Internal notes are complete as-is; everything else benefits from web depth.
    needsWeb: item.sourceType !== 'internal',
  }

  switch (item.sourceType) {
    case 'newsletter':
    case 'twitter':
    case 'internal':
      return fallback
    case 'reddit':
      return (item.url && (await resolveReddit(item))) || fallback
    case 'website':
    case 'product':
    default:
      return (item.url && (await resolveArticle(item))) || fallback
  }
}

const OKF_TYPE: Record<SourceType, string> = {
  newsletter: 'Newsletter',
  website: 'Article',
  twitter: 'Tweet',
  reddit: 'Reddit Post',
  product: 'Product',
  internal: 'Note',
}

function buildBody(item: ResearchItem, resolved: ResolvedSource): string {
  const snippet = snippetOf(item)
  const blocks: string[] = ['# Captured snippet', snippet || '_(no snippet captured)_']
  if (item.notes?.trim()) {
    blocks.push('# Notes', item.notes.trim())
  }
  // Only add a separate source-text section when we got more than the snippet.
  if (resolved.method !== 'snippet' && resolved.text && resolved.text !== snippet) {
    blocks.push('# Source text', resolved.text)
  }
  return blocks.join('\n\n')
}

/** Deterministic OKF concept id for an item's source (stable across builds). */
export function sourceConceptIdFor(item: ResearchItem): string {
  const title = item.pageTitle || item.domain || `Source ${item.id}`
  return conceptIdFor('sources', title, item.id!)
}

export interface EnsuredSource {
  conceptId: string
  method: SourceMethod
  needsWeb: boolean
}

/**
 * Ensure an item has a resolved OKF source concept in the vault, resolving (and
 * caching) only if not already fresh. Returns the concept id + whether the
 * research stage should supplement it from the web.
 */
export async function ensureSourceConcept(
  item: ResearchItem,
  themeNames: string[]
): Promise<EnsuredSource> {
  const itemId = item.id!
  const cached = await getSourceCache(itemId)
  if (isFresh(cached) && cached && (await conceptExists(cached.conceptId))) {
    return { conceptId: cached.conceptId, method: cached.method, needsWeb: cached.needsWeb }
  }

  const resolved = await resolveSource(item)
  const title = item.pageTitle || item.domain || `Source ${itemId}`
  const conceptId = sourceConceptIdFor(item)

  await writeConcept({
    conceptId,
    type: OKF_TYPE[item.sourceType] ?? 'Source',
    title,
    description: item.sourceSender ? `From ${item.sourceSender}` : undefined,
    resource: item.url || undefined,
    tags: themeNames,
    body: buildBody(item, resolved),
  })

  await putSourceCache({
    itemId,
    conceptId,
    method: resolved.method,
    needsWeb: resolved.needsWeb,
    resolvedAt: Date.now(),
  })

  return { conceptId, method: resolved.method, needsWeb: resolved.needsWeb }
}
