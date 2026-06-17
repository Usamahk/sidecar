import { db } from '@/db/schema'

/**
 * Central model catalog + per-role bindings + cost estimation.
 *
 * This is the seam the provider abstraction grows from later. Today every
 * generative role is Anthropic; the `output` role may additionally be set to
 * `manual` (no in-app generation — the user hands the dossier off elsewhere).
 * When a second provider arrives, add it to `ModelProvider` and the catalog;
 * nothing above this module needs to change.
 */

export type ModelProvider = 'anthropic' | 'manual'

export interface ModelInfo {
  id: string
  label: string
  provider: ModelProvider
  /** USD per 1M input tokens. Approximate — used only for cost *estimates*. */
  inputPrice: number
  /** USD per 1M output tokens. */
  outputPrice: number
  hint?: string
}

// Prices are list prices in USD per million tokens at time of writing and are
// intentionally easy to edit — they drive the passive cost *estimate*, not
// billing. Anthropic bills cache reads at ~0.1x input and cache writes at
// ~1.25x input; see estimateCostUsd.
export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', provider: 'anthropic', inputPrice: 15, outputPrice: 75, hint: 'Best reasoning · deepest synthesis' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic', inputPrice: 3, outputPrice: 15, hint: 'Balanced speed/quality' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', provider: 'anthropic', inputPrice: 1, outputPrice: 5, hint: 'Fastest, cheapest' },
]

const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]))

/** Generative roles in the system. `resolve` needs no model (fetch/Readability). */
export type ModelRole = 'scan' | 'insight' | 'research' | 'synthesize' | 'output'

/** Sentinel binding for the output role meaning "no in-app generation". */
export const MANUAL_OUTPUT = 'manual'

export const DEFAULT_ROLE_MODEL: Record<ModelRole, string> = {
  scan: 'claude-sonnet-4-6',
  insight: 'claude-sonnet-4-6',
  research: 'claude-sonnet-4-6',
  synthesize: 'claude-sonnet-4-6',
  output: 'claude-sonnet-4-6',
}

// Back-compat: the scan/insight roles already persisted their model under these
// legacy settings keys, so keep reading them. New roles use `model.<role>`.
const LEGACY_ROLE_KEY: Partial<Record<ModelRole, string>> = {
  scan: 'scanModel',
  insight: 'insightModel',
}

export function settingsKeyForRole(role: ModelRole): string {
  return LEGACY_ROLE_KEY[role] ?? `model.${role}`
}

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_BY_ID.get(id)
}

export function modelLabel(id: string): string {
  return MODEL_BY_ID.get(id)?.label ?? id
}

export function providerForModel(id: string): ModelProvider {
  if (id === MANUAL_OUTPUT) return 'manual'
  return MODEL_BY_ID.get(id)?.provider ?? 'anthropic'
}

/** Resolve the model id bound to a role, falling back to the role default. */
export async function getModelForRole(role: ModelRole): Promise<string> {
  const row = await db.settings.get(settingsKeyForRole(role))
  const bound = row?.value?.trim()
  if (bound) return bound
  return DEFAULT_ROLE_MODEL[role]
}

export async function setModelForRole(role: ModelRole, modelId: string): Promise<void> {
  await db.settings.put({ key: settingsKeyForRole(role), value: modelId })
}

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Estimate the USD cost of a single request from its token usage. Cache reads
 * are billed ~0.1x the input rate and cache writes ~1.25x; uncached input is
 * the remainder. Returns 0 for unknown/manual models.
 */
export function estimateCostUsd(modelId: string, usage: TokenUsage): number {
  const info = MODEL_BY_ID.get(modelId)
  if (!info) return 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const freshInput = Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite)
  const output = usage.output_tokens ?? 0
  const inM = info.inputPrice / 1_000_000
  const outM = info.outputPrice / 1_000_000
  return (
    freshInput * inM +
    cacheRead * inM * 0.1 +
    cacheWrite * inM * 1.25 +
    output * outM
  )
}

/** Compact human-readable cost, e.g. "$0.0042" or "<$0.0001". */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
