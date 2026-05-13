import { db } from './schema'
import { THEME_COLORS, assignTheme } from './themes'
import type { Suggestion, Rejection } from '@/types'
import type { ScanResult } from '@/ai/scan'

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
    await db.suggestions.clear()

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
    // Skip if a rejection for this pair already exists.
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
  } else if (s.kind === 'proposal' && s.proposedName) {
    const nameLower = s.proposedName.trim().toLowerCase()
    const dup = await db.rejections
      .where('proposedNameLower').equals(nameLower).count()
    if (dup === 0) {
      await db.rejections.add({
        kind: 'proposal',
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
  await db.suggestions.clear()
}
