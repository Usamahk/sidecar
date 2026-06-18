import { useEffect, useState } from 'react'
import { getApiKey, subscribeApiKey } from '@/ai/apiKey'

/**
 * Reactive presence of the Anthropic API key (which lives in
 * chrome.storage.local, not IndexedDB). Reads once on mount and updates live
 * when the key is saved or cleared in Settings.
 */
export function useHasApiKey(): boolean {
  const [present, setPresent] = useState(false)
  useEffect(() => {
    let cancelled = false
    getApiKey().then((k) => { if (!cancelled) setPresent(!!k) })
    const unsub = subscribeApiKey(setPresent)
    return () => { cancelled = true; unsub() }
  }, [])
  return present
}
