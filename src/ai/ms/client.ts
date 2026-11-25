import type { DecisionMachine } from '@cloudraker/milliseconds'
import { getMsApiKey } from '@/ai/msApiKey'

/**
 * Lazy milliseconds client. Returns null when no key is set — every caller
 * must treat null as "fall back to the pre-ms behaviour". The SDK is loaded
 * via dynamic import so it stays out of the initial side-panel bundle, same
 * pattern as the Anthropic SDK in scan.ts / builder/index.ts.
 *
 * `dangerouslyAllowBrowser` is required because this is a Chrome extension —
 * the "bundle never reaches a user" the SDK worries about IS the user; the
 * key lives in their own chrome.storage.local and never leaves their browser.
 * Same justification the Anthropic client uses in scan.ts/builder/index.ts.
 */
export async function getDecisionMachine(): Promise<DecisionMachine | null> {
  const apiKey = await getMsApiKey()
  if (!apiKey) return null
  const { DecisionMachine: DM } = await import('@cloudraker/milliseconds')
  return new DM({ apiKey, dangerouslyAllowBrowser: true })
}
