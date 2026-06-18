/**
 * Minimal YAML frontmatter for OKF concept files. We *own* every file we write
 * (the extension is the authoritative writer), so this handles exactly the
 * value shapes we emit — scalars (string/number/boolean) and inline string
 * lists — rather than pulling in a full YAML dependency. The parser is tolerant
 * (unrecognized lines are skipped) per OKF's permissive consumption model.
 */

export type FrontmatterValue = string | number | boolean | string[]
export type Frontmatter = Record<string, FrontmatterValue>

export interface ParsedDoc {
  data: Frontmatter
  body: string
}

const FENCE = '---'

function needsQuoting(s: string): boolean {
  if (s === '') return true
  if (/^\s|\s$/.test(s)) return true
  if (/[:#\[\]{}"'\n]/.test(s)) return true
  // Avoid bare values that would parse back as a non-string scalar.
  if (/^(true|false|null|~)$/i.test(s)) return true
  if (/^-?\d+(\.\d+)?$/.test(s)) return true
  return false
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1)
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
  }
  return t
}

function serializeScalar(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return needsQuoting(v) ? quote(v) : v
}

function serializeValue(v: FrontmatterValue): string {
  if (Array.isArray(v)) {
    return `[${v.map((e) => serializeScalar(e)).join(', ')}]`
  }
  return serializeScalar(v)
}

function parseValue(raw: string): FrontmatterValue {
  const v = raw.trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((e) => unquote(e))
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (/^true$/i.test(v)) return true
  if (/^false$/i.test(v)) return false
  return unquote(v)
}

/** Serialize frontmatter + body into an OKF markdown document. */
export function serialize(data: Frontmatter, body: string): string {
  const lines = [FENCE]
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    lines.push(`${key}: ${serializeValue(value)}`)
  }
  lines.push(FENCE, '')
  const trimmedBody = body.replace(/^\n+/, '')
  return `${lines.join('\n')}\n${trimmedBody}`.replace(/\s*$/, '') + '\n'
}

/** Parse an OKF markdown document into frontmatter data + body. */
export function parse(text: string): ParsedDoc {
  if (!text.startsWith(FENCE)) {
    return { data: {}, body: text }
  }
  const rest = text.slice(FENCE.length)
  const end = rest.indexOf(`\n${FENCE}`)
  if (end === -1) {
    return { data: {}, body: text }
  }
  const block = rest.slice(0, end)
  const body = rest.slice(end + 1 + FENCE.length).replace(/^\n/, '')

  const data: Frontmatter = {}
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    if (!key) continue
    data[key] = parseValue(trimmed.slice(colon + 1))
  }
  return { data, body }
}
