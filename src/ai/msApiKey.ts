import { db } from '@/db/schema'

/**
 * The Milliseconds (decision-machine-1) API key lives in chrome.storage.local
 * for the same reason the Anthropic key does: IndexedDB is serialized into the
 * backup snapshot, so a key stored there would leak into any synced folder.
 *
 * The Milliseconds key is OPTIONAL. When absent, every ms-backed path falls
 * back to today's behaviour (Claude for scan, char-threshold for the resolver,
 * hostname-only for source-type detection).
 */

const KEY = 'millisecondsApiKey'

export async function getMsApiKey(): Promise<string | null> {
  const out = await chrome.storage.local.get(KEY)
  const v = out?.[KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function setMsApiKey(value: string): Promise<void> {
  const trimmed = value.trim()
  if (trimmed) {
    await chrome.storage.local.set({ [KEY]: trimmed })
  } else {
    await chrome.storage.local.remove(KEY)
  }
}

export async function clearMsApiKey(): Promise<void> {
  await chrome.storage.local.remove(KEY)
}

/** Notify when the key's presence changes (e.g. saved/cleared in Settings). */
export function subscribeMsApiKey(cb: (present: boolean) => void): () => void {
  const handler = (
    changes: { [k: string]: chrome.storage.StorageChange },
    area: string
  ) => {
    if (area === 'local' && KEY in changes) {
      const v = changes[KEY].newValue
      cb(typeof v === 'string' && v.trim().length > 0)
    }
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}

/**
 * Legacy settings migration (symmetry with the Anthropic key). The ms key was
 * never stored in db.settings in released builds, but keeping this stub lets a
 * future refactor reuse the same startup call-site without special-casing.
 */
export async function migrateMsApiKeyFromSettings(): Promise<void> {
  const existing = await getMsApiKey()
  if (existing) {
    await db.settings.delete(KEY)
    return
  }
  const row = await db.settings.get(KEY)
  const legacy = row?.value?.trim()
  if (legacy) {
    await chrome.storage.local.set({ [KEY]: legacy })
    await db.settings.delete(KEY)
  }
}
