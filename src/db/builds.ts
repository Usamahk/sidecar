import { db } from './schema'
import type { Build, BuildStatus } from '@/types'

/** Start (or restart) a build for an insight. Returns the build id. */
export async function startBuild(insightId: number): Promise<number> {
  const now = Date.now()
  // Reuse the latest build row for this insight so progress/resume is sticky.
  const existing = await db.builds.where('insightId').equals(insightId).last()
  if (existing?.id != null) {
    await db.builds.update(existing.id, {
      status: 'resolving',
      step: 'Starting…',
      error: undefined,
      startedAt: now,
      updatedAt: now,
    })
    return existing.id
  }
  return db.builds.add({
    insightId,
    status: 'resolving',
    step: 'Starting…',
    resolvedItemIds: [],
    costUsd: 0,
    startedAt: now,
    updatedAt: now,
  }) as Promise<number>
}

export async function getBuild(id: number): Promise<Build | undefined> {
  return db.builds.get(id)
}

export async function getBuildForInsight(insightId: number): Promise<Build | undefined> {
  return db.builds.where('insightId').equals(insightId).last()
}

export async function updateBuild(id: number, changes: Partial<Build>): Promise<void> {
  await db.builds.update(id, { ...changes, updatedAt: Date.now() })
}

export async function setBuildStep(id: number, status: BuildStatus, step: string): Promise<void> {
  await db.builds.update(id, { status, step, updatedAt: Date.now() })
}

/** Record additional resolved items + accrued cost without clobbering prior progress. */
export async function addResolvedItems(id: number, itemIds: number[], addCostUsd = 0): Promise<void> {
  const build = await db.builds.get(id)
  if (!build) return
  const merged = Array.from(new Set([...build.resolvedItemIds, ...itemIds]))
  await db.builds.update(id, {
    resolvedItemIds: merged,
    costUsd: build.costUsd + addCostUsd,
    updatedAt: Date.now(),
  })
}

export async function failBuild(id: number, error: string): Promise<void> {
  await db.builds.update(id, { status: 'error', error, updatedAt: Date.now() })
}
