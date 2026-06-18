import { db } from './schema'
import type { VaultDoc, VaultDocKind } from '@/types'

export async function getVaultDoc(conceptId: string): Promise<VaultDoc | undefined> {
  return db.vaultDocs.get(conceptId)
}

export async function getVaultDocByRef(kind: VaultDocKind, refId: number): Promise<VaultDoc | undefined> {
  return db.vaultDocs.where('refId').equals(refId).filter((d: VaultDoc) => d.kind === kind).first()
}

export async function putVaultDoc(doc: VaultDoc): Promise<void> {
  await db.vaultDocs.put(doc)
}

export async function deleteVaultDoc(conceptId: string): Promise<void> {
  await db.vaultDocs.delete(conceptId)
}

export async function allVaultDocs(): Promise<VaultDoc[]> {
  return db.vaultDocs.toArray()
}
