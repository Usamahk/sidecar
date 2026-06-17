import { db } from './schema'
import { exportAllData, validateBackup, BackupPayload } from './items'

const SNAPSHOT_FILENAME = 'sidecar-snapshot.json'
const HANDLE_KEY = 'backupFolder'
const DEBOUNCE_MS = 2000

let pendingTimer: ReturnType<typeof setTimeout> | null = null
let isWriting = false
let lastWriteAt: number | null = null
let permissionLost = false

type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

export function subscribeBackupStatus(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export interface BackupStatus {
  connected: boolean
  folderName: string | null
  lastWriteAt: number | null
  isWriting: boolean
  permissionLost: boolean
}

let cachedFolderName: string | null = null

export async function getBackupStatus(): Promise<BackupStatus> {
  const row = await db.fileHandles.get(HANDLE_KEY)
  return {
    connected: !!row,
    folderName: row?.handle.name ?? cachedFolderName,
    lastWriteAt,
    isWriting,
    permissionLost,
  }
}

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  // @ts-ignore — queryPermission / requestPermission exist on FSA handles in Chromium.
  const query = await handle.queryPermission?.({ mode })
  if (query === 'granted') return true
  // @ts-ignore
  const req = await handle.requestPermission?.({ mode })
  return req === 'granted'
}

export async function connectBackupFolder(): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  // @ts-ignore — showDirectoryPicker is FSA, only in Chromium-based browsers.
  if (typeof window.showDirectoryPicker !== 'function') {
    return { ok: false, error: 'File System Access not supported in this browser.' }
  }
  try {
    // @ts-ignore
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
      id: 'sidecar-backup',
      mode: 'readwrite',
      startIn: 'documents',
    })
    const ok = await ensurePermission(handle, 'readwrite')
    if (!ok) return { ok: false, error: 'Read-write permission denied.' }
    await db.fileHandles.put({ key: HANDLE_KEY, handle, createdAt: Date.now() })
    cachedFolderName = handle.name
    permissionLost = false
    notify()
    // Write an initial snapshot immediately so the user sees the file appear.
    await writeSnapshot()
    return { ok: true, name: handle.name }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      return { ok: false, error: 'Picker cancelled.' }
    }
    return { ok: false, error: (err as Error).message || 'Could not connect folder.' }
  }
}

export async function disconnectBackupFolder(): Promise<void> {
  await db.fileHandles.delete(HANDLE_KEY)
  cachedFolderName = null
  permissionLost = false
  lastWriteAt = null
  notify()
}

async function writeSnapshot(): Promise<void> {
  const row = await db.fileHandles.get(HANDLE_KEY)
  if (!row) return

  isWriting = true
  notify()

  try {
    const granted = await ensurePermission(row.handle, 'readwrite')
    if (!granted) {
      permissionLost = true
      return
    }
    permissionLost = false

    const payload = await exportAllData()
    const json = JSON.stringify(payload, null, 2)

    const fileHandle = await row.handle.getFileHandle(SNAPSHOT_FILENAME, { create: true })
    // @ts-ignore — createWritable exists on FSA file handles.
    const writable = await fileHandle.createWritable()
    await writable.write(json)
    await writable.close()
    lastWriteAt = Date.now()
  } catch (err) {
    // Most common: NotAllowedError when the user revoked access via the omnibox.
    if ((err as any)?.name === 'NotAllowedError') permissionLost = true
  } finally {
    isWriting = false
    notify()
  }
}

export function scheduleBackup(): void {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    void writeSnapshot()
  }, DEBOUNCE_MS)
}

export async function backupNow(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  await writeSnapshot()
}

/**
 * Hooks Dexie's change events on every data-bearing table so any mutation
 * triggers a debounced snapshot. Safe to call multiple times — subsequent
 * calls are no-ops because Dexie dedupes hook registrations.
 */
let hooksWired = false
export function wireAutoBackupHooks(): void {
  if (hooksWired) return
  hooksWired = true

  const tables = [
    db.items, db.themes, db.insights, db.edges,
    db.attachments, db.settings, db.suggestions, db.rejections,
  ]
  for (const table of tables) {
    table.hook('creating', () => { scheduleBackup() })
    table.hook('updating', () => { scheduleBackup() })
    table.hook('deleting', () => { scheduleBackup() })
  }
}

export async function readSnapshotFromFolder(): Promise<BackupPayload | null> {
  const row = await db.fileHandles.get(HANDLE_KEY)
  if (!row) return null
  const granted = await ensurePermission(row.handle, 'read')
  if (!granted) {
    permissionLost = true
    notify()
    return null
  }
  try {
    const fileHandle = await row.handle.getFileHandle(SNAPSHOT_FILENAME)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return validateBackup(JSON.parse(text))
  } catch (err) {
    if ((err as any)?.name === 'NotFoundError') return null
    throw err
  }
}
