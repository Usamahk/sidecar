import { db } from '@/db/schema'

/**
 * The Anthropic API key lives in chrome.storage.local — NOT in IndexedDB.
 *
 * IndexedDB is serialized into the backup snapshot (and the user is encouraged
 * to point that at a synced folder), so a key stored there would leak into the
 * cloud. chrome.storage.local is machine-local and never exported. `.local`,
 * not `.sync`, so the secret is never replicated through the user's account.
 */

const KEY = 'anthropicApiKey'

export async function getApiKey(): Promise<string | null> {
  const out = await chrome.storage.local.get(KEY)
  const v = out?.[KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function setApiKey(value: string): Promise<void> {
  const trimmed = value.trim()
  if (trimmed) {
    await chrome.storage.local.set({ [KEY]: trimmed })
  } else {
    await chrome.storage.local.remove(KEY)
  }
}

/** Notify when the key's presence changes (e.g. saved/cleared in Settings). */
export function subscribeApiKey(cb: (present: boolean) => void): () => void {
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
 * One-time migration: older builds stored the key in db.settings. If
 * chrome.storage.local has no key yet but a settings row exists, copy it over
 * and delete the settings row so it stops being exported. Safe to call on
 * every startup — it no-ops once migrated.
 */
export async function migrateApiKeyFromSettings(): Promise<void> {
  const existing = await getApiKey()
  if (existing) {
    // Already in storage.local; make sure no stale copy lingers in settings.
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
