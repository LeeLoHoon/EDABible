import type { Entry } from './types'

export interface EntryCommitResult {
  status: 'committed' | 'superseded'
  durableUpdatedAt: number
}

export function resolveEntryCommit(
  current: Entry | undefined,
  snapshot: Entry,
): { write: boolean; result: EntryCommitResult } {
  if (current && current.id === snapshot.id && current.updatedAt >= snapshot.updatedAt) {
    return {
      write: false,
      result: { status: 'superseded', durableUpdatedAt: current.updatedAt },
    }
  }
  return {
    write: true,
    result: { status: 'committed', durableUpdatedAt: snapshot.updatedAt },
  }
}

export interface EntryStoreTx {
  get(id: string): Promise<Entry | undefined>
  put(entry: Entry): Promise<void>
}

export async function commitEntryInTransaction(
  tx: EntryStoreTx,
  snapshot: Entry,
): Promise<EntryCommitResult> {
  const current = await tx.get(snapshot.id)
  const { write, result } = resolveEntryCommit(current, snapshot)
  if (write) await tx.put(snapshot)
  return result
}

export function shouldClearEntryJournalAfterCommit(
  snapshot: Entry,
  pending: Entry | null,
): boolean {
  return pending === snapshot
}
