import { getWritableFolder } from '@/db/backup'
import { VaultError, listConcepts, readConcept } from './okf'

/**
 * Index (catalog) and log (history) files for the OKF bundle. These live at the
 * bundle root and, per OKF §6/§7, carry no frontmatter. `index.md` powers
 * progressive disclosure — an agent reads it first, then drills into concepts.
 */

const INDEX_FILE = 'index.md'
const LOG_FILE = 'log.md'

// Top-level groups the index enumerates, in reading order.
const INDEX_SECTIONS: Array<{ dir: string; heading: string }> = [
  { dir: 'insights', heading: 'Insights' },
  { dir: 'themes', heading: 'Themes' },
  { dir: 'sources', heading: 'Sources' },
  { dir: 'outputs', heading: 'Outputs' },
]

async function root(): Promise<FileSystemDirectoryHandle> {
  const handle = await getWritableFolder()
  if (!handle) {
    throw new VaultError('No vault folder connected. Connect one in Settings → Backup.', 'not_connected')
  }
  return handle
}

async function writeRootFile(name: string, text: string): Promise<void> {
  const dir = await root()
  const fileHandle = await dir.getFileHandle(name, { create: true })
  // @ts-ignore — createWritable exists on FSA file handles in Chromium.
  const writable = await fileHandle.createWritable()
  await writable.write(text)
  await writable.close()
}

async function readRootFile(name: string): Promise<string | null> {
  try {
    const dir = await root()
    const fileHandle = await dir.getFileHandle(name)
    const file = await fileHandle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

/** Read the bundle's index.md catalog (null if not built yet). */
export async function readIndex(): Promise<string | null> {
  return readRootFile(INDEX_FILE)
}

function isoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Rebuild index.md by scanning the bundle's top-level directories. */
export async function rebuildIndex(): Promise<void> {
  const blocks: string[] = ['# Sidecar Knowledge Bundle', '']
  for (const { dir, heading } of INDEX_SECTIONS) {
    const ids = await listConcepts(dir)
    if (ids.length === 0) continue
    blocks.push(`# ${heading}`, '')
    const rows = await Promise.all(ids.map((id) => readConcept(id)))
    for (const c of rows) {
      if (!c) continue
      const title = c.title || c.conceptId.split('/').pop()!
      const desc = c.description ? ` - ${c.description}` : ''
      blocks.push(`* [${title}](/${c.conceptId}.md)${desc}`)
    }
    blocks.push('')
  }
  await writeRootFile(INDEX_FILE, blocks.join('\n').replace(/\s*$/, '') + '\n')
}

/**
 * Append a log entry under today's date heading (newest date first), per
 * OKF §7. `kind` is the conventional bold lead word (Creation/Update/…).
 */
export async function appendLog(kind: string, text: string): Promise<void> {
  const today = isoDate()
  const entry = `* **${kind}**: ${text}`
  const existing = await readRootFile(LOG_FILE)

  if (!existing) {
    await writeRootFile(LOG_FILE, `# Update Log\n\n## ${today}\n${entry}\n`)
    return
  }

  const lines = existing.split('\n')
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`)
  if (todayIdx !== -1) {
    lines.splice(todayIdx + 1, 0, entry)
  } else {
    // Insert a new date section before the first existing date heading so the
    // newest date stays on top; fall back to appending after the title.
    const firstDateIdx = lines.findIndex((l) => /^##\s+\d{4}-\d{2}-\d{2}\s*$/.test(l.trim()))
    const section = [`## ${today}`, entry, '']
    if (firstDateIdx !== -1) {
      lines.splice(firstDateIdx, 0, ...section)
    } else {
      const titleIdx = lines.findIndex((l) => l.startsWith('# '))
      const at = titleIdx === -1 ? 0 : titleIdx + 1
      lines.splice(at, 0, '', ...section)
    }
  }
  await writeRootFile(LOG_FILE, lines.join('\n').replace(/\s*$/, '') + '\n')
}
