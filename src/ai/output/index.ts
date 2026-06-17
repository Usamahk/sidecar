import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/db/schema'
import { getApiKey } from '@/ai/apiKey'
import {
  getModelForRole,
  estimateCostUsd,
  providerForModel,
  MANUAL_OUTPUT,
  type TokenUsage,
} from '@/ai/models'
import { readConcept, writeConcept, slugify, conceptExists, rebuildIndex, appendLog } from '@/vault'
import { getTemplate } from './templates'

export { OUTPUT_TEMPLATES, getTemplate, type OutputTemplate } from './templates'

export class OutputError extends Error {
  constructor(message: string, public readonly code: 'no_api_key' | 'no_dossier' | 'bad_template' | 'api' = 'api') {
    super(message)
    this.name = 'OutputError'
  }
}

export type OutputResult =
  | { manual: true; dossier: string }            // no in-app model — hand off the dossier
  | { manual: false; conceptId: string; body: string; costUsd: number }

async function getVoiceProfile(): Promise<string> {
  const row = await db.settings.get('voiceProfile')
  return row?.value?.trim() ?? ''
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * Generate an output from a dossier via the (swappable) output model role. If
 * the role is set to MANUAL, returns the dossier text for the caller to hand
 * off — no generation happens.
 */
export async function generateOutput(dossierConceptId: string, templateId: string): Promise<OutputResult> {
  const template = getTemplate(templateId)
  if (!template) throw new OutputError(`Unknown output format "${templateId}".`, 'bad_template')

  const dossier = await readConcept(dossierConceptId)
  if (!dossier) throw new OutputError('Dossier not found in the vault.', 'no_dossier')

  const model = await getModelForRole('output')
  if (model === MANUAL_OUTPUT || providerForModel(model) === 'manual') {
    return { manual: true, dossier: dossier.body }
  }

  const apiKey = await getApiKey()
  if (!apiKey) throw new OutputError('No Anthropic API key set. Add one in Settings.', 'no_api_key')

  const voice = await getVoiceProfile()
  const system = [
    `You are Sidecar's output writer. Transform the provided research dossier into a ${template.label}.`,
    template.structurePrompt,
    voice ? `Match this voice/style: ${voice}` : 'Use a clear, engaging, non-generic voice.',
    'Preserve source links where they strengthen the piece. Output only the Markdown piece.',
  ].join('\n')

  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true })

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages: [
        {
          role: 'user',
          content: `Dossier title: ${dossier.title ?? dossierConceptId}\n\n${dossier.body}`,
        },
      ],
    })
  } catch (err) {
    throw new OutputError(err instanceof Error ? err.message : 'Output generation failed', 'api')
  }

  const body = extractText(message)
  if (!body) throw new OutputError('The model returned an empty draft.', 'api')

  const baseTitle = dossier.title ?? dossierConceptId.split('/').pop()!
  const conceptId = `outputs/${slugify(baseTitle)}-${template.id}`
  const existed = await conceptExists(conceptId)
  await writeConcept({
    conceptId,
    type: template.okfType,
    title: `${baseTitle} — ${template.label}`,
    description: `Generated from ${dossierConceptId}`,
    tags: dossier.tags,
    body,
  })

  await rebuildIndex()
  await appendLog(existed ? 'Update' : 'Creation', `${template.label} from [${baseTitle}](/${dossierConceptId}.md) → [${conceptId}](/${conceptId}.md)`)

  const costUsd = estimateCostUsd(model, message.usage as TokenUsage)
  return { manual: false, conceptId, body, costUsd }
}
