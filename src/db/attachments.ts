import { db } from './schema'
import type { Attachment } from '@/types'

export async function addAttachment(
  itemId: number,
  blob: Blob,
  name = 'screenshot.png'
): Promise<number> {
  return db.attachments.add({
    itemId,
    blob,
    mimeType: blob.type || 'image/png',
    name,
    createdAt: Date.now(),
  })
}

export async function getAttachments(itemId: number): Promise<Attachment[]> {
  return db.attachments.where('itemId').equals(itemId).toArray()
}

export async function deleteAttachment(id: number): Promise<void> {
  await db.attachments.delete(id)
}

export async function deleteAttachmentsForItem(itemId: number): Promise<void> {
  await db.attachments.where('itemId').equals(itemId).delete()
}
