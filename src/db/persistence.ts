import { db } from './schema'

export type PersistStatus = 'persistent' | 'transient' | 'unsupported' | 'error'

/**
 * Ask the browser to mark our storage as persistent. Survives passive eviction
 * under disk pressure; does NOT protect against the user deliberately clearing
 * site data via Chrome's settings. The user-chosen backup folder is the real
 * durability layer for that case.
 */
export async function requestPersistentStorage(): Promise<PersistStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return 'unsupported'
  }
  try {
    const already = await navigator.storage.persisted()
    if (already) {
      await db.settings.put({ key: 'storagePersistent', value: 'true' })
      return 'persistent'
    }
    const granted = await navigator.storage.persist()
    await db.settings.put({ key: 'storagePersistent', value: granted ? 'true' : 'false' })
    return granted ? 'persistent' : 'transient'
  } catch {
    return 'error'
  }
}

export async function getPersistStatus(): Promise<PersistStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return 'unsupported'
  }
  try {
    const isPersistent = await navigator.storage.persisted()
    return isPersistent ? 'persistent' : 'transient'
  } catch {
    return 'error'
  }
}
