import { db } from './schema'
import type { Theme } from '@/types'

export const THEME_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
]

export async function addTheme(name: string, description = ''): Promise<number> {
  const existing = await db.themes.count()
  const color = THEME_COLORS[existing % THEME_COLORS.length]
  const id = await db.themes.add({ name, description, color, createdAt: Date.now() })
  // Self-heal: clear any prior rejection of this proposed name.
  await db.rejections
    .where('proposedNameLower').equals(name.trim().toLowerCase())
    .delete()
  return id
}

export async function updateTheme(id: number, changes: Partial<Theme>): Promise<void> {
  await db.themes.update(id, changes)
}

export async function deleteTheme(id: number): Promise<void> {
  await db.themes.delete(id)
  // Remove this theme from all items
  const items = await db.items.where('themeIds').equals(id).toArray()
  for (const item of items) {
    await db.items.update(item.id!, {
      themeIds: item.themeIds.filter((t) => t !== id),
      updatedAt: Date.now(),
    })
  }
  await db.edges.where('fromId').equals(id).delete()
  await db.edges.where('toId').equals(id).delete()
  // Drop any rejections referencing this theme — they're meaningless now.
  await db.rejections.where('themeId').equals(id).delete()
  // Also drop any pending suggestions for this theme.
  await db.suggestions.where('themeId').equals(id).delete()
}

export async function assignTheme(itemId: number, themeId: number): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item) return
  if (item.themeIds.includes(themeId)) return
  await db.items.update(itemId, {
    themeIds: [...item.themeIds, themeId],
    updatedAt: Date.now(),
  })
  await db.edges.add({
    fromId: itemId, fromType: 'item',
    toId: themeId, toType: 'theme',
    type: 'item-theme', weight: 1,
  })
  // Self-heal: clear any prior rejection of this exact (item, theme) pair.
  await db.rejections.where('[itemId+themeId]').equals([itemId, themeId]).delete()
}

export async function removeTheme(itemId: number, themeId: number): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item) return
  await db.items.update(itemId, {
    themeIds: item.themeIds.filter((t) => t !== themeId),
    updatedAt: Date.now(),
  })
  await db.edges
    .where({ fromId: itemId, toId: themeId, type: 'item-theme' })
    .delete()
}
