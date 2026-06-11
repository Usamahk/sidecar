import { db } from './schema'
import { THEME_COLORS, assignTheme } from './themes'
import { assignConcept } from './concepts'
import type { Suggestion, Rejection } from '@/types'
import type { ScanResult } from '@/ai/scan'
import type { ExtractResult } from '@/ai/extractConcepts'

export async function pickNextThemeColor(): Promise<string> {
  const existing = await db.themes.count()
  return THEME_COLORS[existing % THEME_COLORS.length]
}

export async function replaceQueue(result: ScanResult): Promise<string> {
  const scanId = `scan-${Date.now()}`
  const now = Date.now()

  // Pre-pick colors for proposals so the UI has stable swatches before approval.
  const baseColorCount = await db.themes.count()

  await db.transaction('rw', db.suggestions, async () => {
    await db.suggestions
      .filter((s: Suggestion) => s.kind === 'assignment' || s.kind === 'proposal')
      .delete()

    const rows: Suggestion[] = []

    for (const a of result.assignments) {
      rows.push({
        kind: 'assignment',
        scanId,
        createdAt: now,
        itemId: a.itemId,
        themeId: a.themeId,
        confidence: a.confidence,
      })
    }

    result.proposals.forEach((p, i) => {
      rows.push({
        kind: 'proposal',
        scanId,
        createdAt: now,
        proposedName: p.name,
        proposedDescription: p.description,
        proposedColor: THEME_COLORS[(baseColorCount + i) % THEME_COLORS.length],
        supportingItemIds: p.supportingItemIds,
      })
    })

    if (rows.length > 0) await db.suggestions.bulkAdd(rows)
  })

  await db.settings.put({ key: 'lastScanAt', value: String(now) })
  return scanId
}

async function recordRejection(s: Suggestion): Promise<void> {
  const now = Date.now()
  if (s.kind === 'assignment' && s.itemId != null && s.themeId != null) {
    const dup = await db.rejections
      .where('[itemId+themeId]').equals([s.itemId, s.themeId]).count()
    if (dup === 0) {
      await db.rejections.add({
        kind: 'assignment',
        itemId: s.itemId,
        themeId: s.themeId,
        createdAt: now,
      })
    }
  } else if (s.kind === 'concept-assignment' && s.itemId != null && s.conceptId != null) {
    const dup = await db.rejections
      .where('[itemId+conceptId]').equals([s.itemId, s.conceptId]).count()
    if (dup === 0) {
      await db.rejections.add({
        kind: 'concept-assignment',
        itemId: s.itemId,
        conceptId: s.conceptId,
        createdAt: now,
      })
    }
  } else if ((s.kind === 'proposal' || s.kind === 'concept-proposal') && s.proposedName) {
    const nameLower = s.proposedName.trim().toLowerCase()
    const dup = await db.rejections
      .where('proposedNameLower').equals(nameLower)
      .filter((r: Rejection) => r.kind === s.kind)
      .count()
    if (dup === 0) {
      await db.rejections.add({
        kind: s.kind,
        proposedNameLower: nameLower,
        createdAt: now,
      })
    }
  }
}

export async function rejectSuggestion(id: number): Promise<void> {
  const s = await db.suggestions.get(id)
  if (s) await recordRejection(s)
  await db.suggestions.delete(id)
}

export async function approveAssignment(id: number): Promise<void> {
  const s = await db.suggestions.get(id)
  if (!s || s.kind !== 'assignment' || !s.itemId || !s.themeId) return
  await assignTheme(s.itemId, s.themeId)
  await db.suggestions.delete(id)
}

export async function bulkApproveByTheme(themeId: number): Promise<void> {
  const matches = await db.suggestions
    .where('themeId').equals(themeId)
    .filter((s: Suggestion) => s.kind === 'assignment')
    .toArray()
  for (const s of matches) {
    if (s.itemId) await assignTheme(s.itemId, themeId)
  }
  await db.suggestions
    .where('themeId').equals(themeId)
    .filter((s: Suggestion) => s.kind === 'assignment')
    .delete()
}

export async function bulkRejectByTheme(themeId: number): Promise<void> {
  const matches = await db.suggestions
    .where('themeId').equals(themeId)
    .filter((s: Suggestion) => s.kind === 'assignment')
    .toArray()
  for (const s of matches) await recordRejection(s)
  await db.suggestions
    .where('themeId').equals(themeId)
    .filter((s: Suggestion) => s.kind === 'assignment')
    .delete()
}

export async function getRejections(): Promise<{
  proposedNamesLower: string[]
  assignmentPairs: Array<[number, number]>
}> {
  const all = await db.rejections.toArray()
  return {
    proposedNamesLower: all
      .filter((r: Rejection) => r.kind === 'proposal' && !!r.proposedNameLower)
      .map((r: Rejection) => r.proposedNameLower!),
    assignmentPairs: all
      .filter((r: Rejection) => r.kind === 'assignment' && r.itemId != null && r.themeId != null)
      .map((r: Rejection) => [r.itemId!, r.themeId!] as [number, number]),
  }
}

interface ApproveProposalChanges {
  name?: string
  color?: string
}

export async function approveProposal(
  id: number,
  changes: ApproveProposalChanges = {}
): Promise<number | null> {
  const s = await db.suggestions.get(id)
  if (!s || s.kind !== 'proposal') return null

  const name = (changes.name ?? s.proposedName ?? '').trim()
  if (!name) return null
  const color = changes.color ?? s.proposedColor ?? await pickNextThemeColor()
  const description = s.proposedDescription ?? ''

  const themeId = await db.themes.add({
    name,
    description,
    color,
    createdAt: Date.now(),
  }) as number

  for (const itemId of s.supportingItemIds ?? []) {
    await assignTheme(itemId, themeId)
  }

  await db.suggestions.delete(id)
  return themeId
}

export async function updateProposal(
  id: number,
  changes: { name?: string; color?: string }
): Promise<void> {
  const patch: Partial<Suggestion> = {}
  if (changes.name !== undefined) patch.proposedName = changes.name
  if (changes.color !== undefined) patch.proposedColor = changes.color
  await db.suggestions.update(id, patch)
}

export async function dismissAll(): Promise<void> {
  await db.suggestions
    .filter((s: Suggestion) => s.kind === 'assignment' || s.kind === 'proposal')
    .delete()
}

export async function dismissAllConcepts(): Promise<void> {
  await db.suggestions
    .filter((s: Suggestion) => s.kind === 'concept-assignment' || s.kind === 'concept-proposal')
    .delete()
}

// ---------- Concept suggestion queue ----------

export async function replaceConceptQueue(result: ExtractResult): Promise<string> {
  const scanId = `concept-${Date.now()}`
  const now = Date.now()

  await db.transaction('rw', db.suggestions, async () => {
    await db.suggestions
      .filter((s: Suggestion) => s.kind === 'concept-assignment' || s.kind === 'concept-proposal')
      .delete()

    const rows: Suggestion[] = []

    for (const a of result.assignments) {
      rows.push({
        kind: 'concept-assignment',
        scanId,
        createdAt: now,
        itemId: a.itemId,
        conceptId: a.conceptId,
        confidence: a.confidence,
      })
    }

    for (const p of result.proposals) {
      rows.push({
        kind: 'concept-proposal',
        scanId,
        createdAt: now,
        proposedName: p.name,
        proposedDescription: p.description,
        supportingItemIds: p.supportingItemIds,
      })
    }

    if (rows.length > 0) await db.suggestions.bulkAdd(rows)
  })

  await db.settings.put({ key: 'lastConceptExtractAt', value: String(now) })
  return scanId
}

export async function approveConceptAssignment(id: number): Promise<void> {
  const s = await db.suggestions.get(id)
  if (!s || s.kind !== 'concept-assignment' || !s.itemId || !s.conceptId) return
  await assignConcept(s.itemId, s.conceptId)
  await db.suggestions.delete(id)
}

export async function approveConceptProposal(
  id: number,
  changes: { name?: string } = {}
): Promise<number | null> {
  const s = await db.suggestions.get(id)
  if (!s || s.kind !== 'concept-proposal') return null

  const name = (changes.name ?? s.proposedName ?? '').trim()
  if (!name) return null
  const description = s.proposedDescription ?? ''

  const conceptId = await db.concepts.add({ name, description }) as number

  for (const itemId of s.supportingItemIds ?? []) {
    await assignConcept(itemId, conceptId)
  }

  await db.suggestions.delete(id)
  return conceptId
}

export async function bulkApproveByConcept(conceptId: number): Promise<void> {
  const matches = await db.suggestions
    .where('conceptId').equals(conceptId)
    .filter((s: Suggestion) => s.kind === 'concept-assignment')
    .toArray()
  for (const s of matches) {
    if (s.itemId) await assignConcept(s.itemId, conceptId)
  }
  await db.suggestions
    .where('conceptId').equals(conceptId)
    .filter((s: Suggestion) => s.kind === 'concept-assignment')
    .delete()
}

export async function bulkRejectByConcept(conceptId: number): Promise<void> {
  const matches = await db.suggestions
    .where('conceptId').equals(conceptId)
    .filter((s: Suggestion) => s.kind === 'concept-assignment')
    .toArray()
  for (const s of matches) await recordRejection(s)
  await db.suggestions
    .where('conceptId').equals(conceptId)
    .filter((s: Suggestion) => s.kind === 'concept-assignment')
    .delete()
}

export async function updateConceptProposal(
  id: number,
  changes: { name?: string }
): Promise<void> {
  const patch: Partial<Suggestion> = {}
  if (changes.name !== undefined) patch.proposedName = changes.name
  await db.suggestions.update(id, patch)
}

export async function getConceptRejections(): Promise<{
  proposedNamesLower: string[]
  assignmentPairs: Array<[number, number]>
}> {
  const all = await db.rejections.toArray()
  return {
    proposedNamesLower: all
      .filter((r: Rejection) => r.kind === 'concept-proposal' && !!r.proposedNameLower)
      .map((r: Rejection) => r.proposedNameLower!),
    assignmentPairs: all
      .filter((r: Rejection) => r.kind === 'concept-assignment' && r.itemId != null && r.conceptId != null)
      .map((r: Rejection) => [r.itemId!, r.conceptId!] as [number, number]),
  }
}
