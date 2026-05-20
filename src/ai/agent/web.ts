import type { AgentCitation } from '@/types'

export interface WebContextHit {
  title: string
  url: string
  snippet: string
  citation: AgentCitation
}

const WIKI_SEARCH_URL = 'https://en.wikipedia.org/w/api.php'
const WIKI_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary'

function normalizeSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 280 ? `${flat.slice(0, 280)}…` : flat
}

function toRefId(index: number): string {
  return `W${index + 1}`
}

export async function fetchWebContext(query: string, maxHits: number): Promise<WebContextHit[]> {
  const params = new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: String(maxHits),
    namespace: '0',
    format: 'json',
    origin: '*',
  })
  const searchResp = await fetch(`${WIKI_SEARCH_URL}?${params.toString()}`)
  if (!searchResp.ok) return []
  const [_, titles, __, urls] = await searchResp.json() as [string, string[], string[], string[]]
  const picked = (titles ?? []).map((title, i) => ({ title, url: urls?.[i] ?? '' })).filter((x) => x.url)
  const summaries = await Promise.all(
    picked.map(async (entry, i) => {
      try {
        const page = encodeURIComponent(entry.title.replace(/ /g, '_'))
        const resp = await fetch(`${WIKI_SUMMARY_URL}/${page}`)
        if (!resp.ok) return null
        const data = await resp.json() as { extract?: string; description?: string }
        const snippet = normalizeSnippet(data.extract || data.description || 'Wikipedia article')
        const refId = toRefId(i)
        const citation: AgentCitation = {
          kind: 'web',
          refId,
          title: entry.title,
          url: entry.url,
          snippet,
          domain: 'wikipedia.org',
        }
        return { ...entry, snippet, citation }
      } catch {
        return null
      }
    })
  )
  return summaries.filter((x): x is WebContextHit => !!x)
}
