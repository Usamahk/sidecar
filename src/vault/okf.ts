import { getWritableFolder } from '@/db/backup'
import { serialize, parse, type Frontmatter } from './frontmatter'

/**
 * OKF vault layer. Reads/writes a bundle of OKF markdown concepts into the
 * connected folder (alongside sidecar-snapshot.json). The extension is the
 * authoritative writer; Obsidian is a read-only window. These writes go
 * directly through the File System Access API and never touch Dexie, so they
 * are independent of the corpus JSON-snapshot write path.
 *
 * Concept ID = the file path within the bundle minus the `.md` suffix
 * (OKF §2), e.g. `insights/plg-pricing-3` ⇄ `insights/plg-pricing-3.md`.
 */

export class VaultError extends Error {
  constructor(message: string, public readonly code: 'not_connected' | 'io' = 'io') {
    super(message)
    this.name = 'VaultError'
  }
}

export interface OKFConcept {
  conceptId: string
  type: string                 // OKF required
  title?: string
  description?: string
  resource?: string            // canonical URI of the underlying asset
  tags?: string[]
  timestamp?: string           // ISO 8601
  extra?: Frontmatter          // additional producer-defined keys
  body: string
}

const RESERVED = new Set(['index', 'log'])

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled'
}

/** Stable concept id: `<dir>/<slug>-<id>` so renamed titles don't orphan files. */
export function conceptIdFor(dir: string, title: string, id: number): string {
  return `${dir}/${slugify(title)}-${id}`
}

/** A bundle-relative markdown link to a concept (OKF §5.1, recommended form). */
export function linkTo(conceptId: string, label: string): string {
  return `[${label}](/${conceptId}.md)`
}

async function root(): Promise<FileSystemDirectoryHandle> {
  const handle = await getWritableFolder()
  if (!handle) {
    throw new VaultError('No vault folder connected. Connect one in Settings → Backup.', 'not_connected')
  }
  return handle
}

function splitConceptId(conceptId: string): { dirs: string[]; name: string } {
  const parts = conceptId.replace(/^\/+|\/+$/g, '').split('/')
  const name = parts.pop()!
  return { dirs: parts, name }
}

async function resolveDir(
  start: FileSystemDirectoryHandle,
  dirs: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle | null> {
  let cur = start
  for (const d of dirs) {
    try {
      cur = await cur.getDirectoryHandle(d, { create })
    } catch {
      if (!create) return null
      throw new VaultError(`Could not create directory "${d}".`)
    }
  }
  return cur
}

export async function writeConcept(concept: OKFConcept): Promise<void> {
  const { dirs, name } = splitConceptId(concept.conceptId)
  const dir = await resolveDir(await root(), dirs, true)
  if (!dir) throw new VaultError('Could not resolve target directory.')

  const data: Frontmatter = { type: concept.type }
  if (concept.title) data.title = concept.title
  if (concept.description) data.description = concept.description
  if (concept.resource) data.resource = concept.resource
  if (concept.tags && concept.tags.length) data.tags = concept.tags
  data.timestamp = concept.timestamp ?? new Date().toISOString()
  for (const [k, v] of Object.entries(concept.extra ?? {})) {
    if (!(k in data)) data[k] = v
  }

  const text = serialize(data, concept.body)
  const fileHandle = await dir.getFileHandle(`${name}.md`, { create: true })
  // @ts-ignore — createWritable exists on FSA file handles in Chromium.
  const writable = await fileHandle.createWritable()
  await writable.write(text)
  await writable.close()
}

export async function readConcept(conceptId: string): Promise<OKFConcept | null> {
  const { dirs, name } = splitConceptId(conceptId)
  const dir = await resolveDir(await root(), dirs, false)
  if (!dir) return null
  try {
    const fileHandle = await dir.getFileHandle(`${name}.md`)
    const file = await fileHandle.getFile()
    const { data, body } = parse(await file.text())
    const { type, title, description, resource, tags, timestamp, ...extra } = data
    return {
      conceptId,
      type: typeof type === 'string' ? type : 'Concept',
      title: typeof title === 'string' ? title : undefined,
      description: typeof description === 'string' ? description : undefined,
      resource: typeof resource === 'string' ? resource : undefined,
      tags: Array.isArray(tags) ? (tags as string[]) : undefined,
      timestamp: typeof timestamp === 'string' ? timestamp : undefined,
      extra: extra as Frontmatter,
      body,
    }
  } catch {
    return null
  }
}

export async function conceptExists(conceptId: string): Promise<boolean> {
  const { dirs, name } = splitConceptId(conceptId)
  const dir = await resolveDir(await root(), dirs, false)
  if (!dir) return false
  try {
    await dir.getFileHandle(`${name}.md`)
    return true
  } catch {
    return false
  }
}

export async function deleteConcept(conceptId: string): Promise<void> {
  const { dirs, name } = splitConceptId(conceptId)
  const dir = await resolveDir(await root(), dirs, false)
  if (!dir) return
  try {
    await dir.removeEntry(`${name}.md`)
  } catch {
    /* already gone */
  }
}

/** List concept ids directly under a bundle directory (excludes index/log). */
export async function listConcepts(dirPath: string): Promise<string[]> {
  const dir = await resolveDir(await root(), dirPath.split('/').filter(Boolean), false)
  if (!dir) return []
  const ids: string[] = []
  // @ts-ignore — async entries() iterator exists on FSA directory handles.
  for await (const [entryName, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !entryName.endsWith('.md')) continue
    const base = entryName.slice(0, -3)
    if (RESERVED.has(base)) continue
    ids.push(dirPath ? `${dirPath}/${base}` : base)
  }
  return ids
}
