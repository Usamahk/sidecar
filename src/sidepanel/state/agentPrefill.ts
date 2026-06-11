import { db } from '@/db/schema'
import type { GraphNode } from '@/db/graph'

let pending: string | null = null
type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

export function subscribeAgentPrefill(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getAgentPrefill(): string | null {
  return pending
}

export function clearAgentPrefill(): void {
  pending = null
  notify()
}

export async function setAgentPrefill(node: GraphNode): Promise<void> {
  pending = await buildPrompt(node)
  notify()
}

async function buildPrompt(node: GraphNode): Promise<string> {
  if (node.type === 'item') {
    const item = await db.items.get(node.refId)
    if (!item) return `Tell me about the item titled "${node.label}".`
    const text = (item.rawContent || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    return `Summarize what this captured item says and how it connects to other items in my corpus:\n\n"${text}"`
  }
  if (node.type === 'theme') {
    return `What are the main threads across the items I've tagged with the theme "${node.label}"? Pull in the strongest connections.`
  }
  return `What have I captured about "${node.label}"? Trace how this concept shows up across my items.`
}
