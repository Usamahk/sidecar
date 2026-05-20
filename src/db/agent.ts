import { db } from './schema'
import type { AgentCitation, AgentConversation, AgentMessage } from '@/types'

function makeTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.replace(/\s+/g, ' ').trim()
  if (!firstLine) return 'New chat'
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
}

export async function createConversation(initialPrompt: string): Promise<number> {
  const now = Date.now()
  return db.conversations.add({
    title: makeTitleFromPrompt(initialPrompt),
    lastMessagePreview: '',
    createdAt: now,
    updatedAt: now,
  })
}

export async function listConversations(): Promise<AgentConversation[]> {
  return db.conversations.orderBy('updatedAt').reverse().toArray()
}

export async function listMessages(conversationId: number): Promise<AgentMessage[]> {
  return db.messages
    .where('conversationId')
    .equals(conversationId)
    .sortBy('createdAt')
}

export async function addMessage(input: {
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  citations?: AgentCitation[]
  usedWeb?: boolean
  model?: string
}): Promise<number> {
  const now = Date.now()
  const id = await db.messages.add({
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    citations: input.citations ?? [],
    usedWeb: input.usedWeb ?? false,
    model: input.model ?? '',
    createdAt: now,
  })
  await db.conversations.update(input.conversationId, {
    lastMessagePreview: input.content.slice(0, 120),
    updatedAt: now,
  })
  return id
}

export async function updateMessage(id: number, changes: Partial<AgentMessage>): Promise<void> {
  await db.messages.update(id, changes)
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await db.transaction('rw', [db.conversations, db.messages], async () => {
    await db.messages.where('conversationId').equals(conversationId).delete()
    await db.conversations.delete(conversationId)
  })
}

export async function getConversation(conversationId: number): Promise<AgentConversation | undefined> {
  return db.conversations.get(conversationId)
}
