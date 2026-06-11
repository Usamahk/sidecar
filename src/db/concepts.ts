import { db } from './schema'
import type { Concept } from '@/types'

export async function addConcept(name: string, description = ''): Promise<number> {
  const id = await db.concepts.add({ name, description })
  await db.rejections
    .where('proposedNameLower').equals(name.trim().toLowerCase())
    .delete()
  return id
}

export async function updateConcept(id: number, changes: Partial<Concept>): Promise<void> {
  await db.concepts.update(id, changes)
}

export async function deleteConcept(id: number): Promise<void> {
  await db.concepts.delete(id)
  const items = await db.items.where('conceptIds').equals(id).toArray()
  for (const item of items) {
    await db.items.update(item.id!, {
      conceptIds: item.conceptIds.filter((c: number) => c !== id),
      updatedAt: Date.now(),
    })
  }
  await db.edges.where('fromId').equals(id).delete()
  await db.edges.where('toId').equals(id).delete()
  await db.rejections.where('conceptId').equals(id).delete()
  await db.suggestions.where('conceptId').equals(id).delete()
}

export async function assignConcept(itemId: number, conceptId: number): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item) return
  if (item.conceptIds.includes(conceptId)) return
  await db.items.update(itemId, {
    conceptIds: [...item.conceptIds, conceptId],
    updatedAt: Date.now(),
  })
  await db.edges.add({
    fromId: itemId, fromType: 'item',
    toId: conceptId, toType: 'concept',
    type: 'item-concept', weight: 1,
  })
  await db.rejections.where('[itemId+conceptId]').equals([itemId, conceptId]).delete()
}

export async function removeConcept(itemId: number, conceptId: number): Promise<void> {
  const item = await db.items.get(itemId)
  if (!item) return
  await db.items.update(itemId, {
    conceptIds: item.conceptIds.filter((c: number) => c !== conceptId),
    updatedAt: Date.now(),
  })
  await db.edges
    .where({ fromId: itemId, toId: conceptId, type: 'item-concept' })
    .delete()
}
