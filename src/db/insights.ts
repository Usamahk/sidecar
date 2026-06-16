import { db } from './schema'
import type { Insight } from '@/types'

export async function addInsight(
  partial: Omit<Insight, 'id' | 'generatedAt'> & { generatedAt?: number }
): Promise<number> {
  const generatedAt = partial.generatedAt ?? Date.now()
  const id = await db.insights.add({
    ...partial,
    generatedAt,
  }) as number
  // Mirror edges so the graph layer can find them without scanning insights.
  for (const themeId of partial.themeIds) {
    await db.edges.add({
      fromId: id, fromType: 'insight',
      toId: themeId, toType: 'theme',
      type: 'insight-theme', weight: 1,
    })
  }
  for (const itemId of partial.itemIds) {
    await db.edges.add({
      fromId: id, fromType: 'insight',
      toId: itemId, toType: 'item',
      type: 'insight-item', weight: 1,
    })
  }
  // Self-heal: clear any prior rejection of this proposed headline.
  await db.rejections
    .where('proposedNameLower').equals(partial.headline.trim().toLowerCase())
    .delete()
  return id
}

export async function updateInsight(id: number, changes: Partial<Insight>): Promise<void> {
  await db.insights.update(id, changes)
  // If theme/item membership changed, rebuild this insight's edges.
  if (changes.themeIds || changes.itemIds) {
    await db.edges.where('fromId').equals(id).filter((e: any) =>
      e.fromType === 'insight'
    ).delete()
    const fresh = await db.insights.get(id)
    if (!fresh) return
    for (const themeId of fresh.themeIds) {
      await db.edges.add({
        fromId: id, fromType: 'insight',
        toId: themeId, toType: 'theme',
        type: 'insight-theme', weight: 1,
      })
    }
    for (const itemId of fresh.itemIds) {
      await db.edges.add({
        fromId: id, fromType: 'insight',
        toId: itemId, toType: 'item',
        type: 'insight-item', weight: 1,
      })
    }
  }
}

export async function deleteInsight(id: number): Promise<void> {
  await db.insights.delete(id)
  await db.edges.where('fromId').equals(id).filter((e: any) =>
    e.fromType === 'insight'
  ).delete()
  await db.edges.where('toId').equals(id).filter((e: any) =>
    e.toType === 'insight'
  ).delete()
}
