import type { Entry } from './types'

export type EntryTransitionResult = 'loaded' | 'cleared' | 'blocked' | 'aborted'

export const ENTRY_RETRY_DELAYS_MS = [500, 1_000] as const

export type EntryRetryWait = (delayMs: number) => Promise<void>

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function retryEntryOperation<T>(
  operation: (attempt: number) => Promise<T>,
  wait: EntryRetryWait = waitForRetry,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= ENTRY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation(attempt + 1)
    } catch (error) {
      lastError = error
      const delay = ENTRY_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await wait(delay)
    }
  }
  throw lastError
}

export interface EntryTransitionPorts {
  getPendingId(): string | undefined
  flushPending(): Promise<void>
  clearExposedEntry(): void
  loadEntry(id: string): Promise<void>
  isCurrent(id: string | undefined): boolean
}

export async function runEntryTransition(
  requestedId: string | undefined,
  loadedId: string | undefined,
  ports: EntryTransitionPorts,
): Promise<EntryTransitionResult> {
  const pendingId = ports.getPendingId()
  if (
    requestedId !== undefined &&
    requestedId === loadedId &&
    (pendingId === undefined || pendingId === requestedId)
  ) {
    return 'aborted'
  }
  if (pendingId !== undefined && pendingId !== requestedId) {
    ports.clearExposedEntry()
    try {
      await ports.flushPending()
    } catch {
      return 'blocked'
    }
    if (!ports.isCurrent(requestedId)) return 'aborted'
  }

  if (requestedId === undefined) {
    ports.clearExposedEntry()
    return 'cleared'
  }

  await ports.loadEntry(requestedId)
  if (!ports.isCurrent(requestedId)) return 'aborted'
  return 'loaded'
}

export function selectUpdateBase(
  activeId: string | undefined,
  loadedId: string | undefined,
  pending: Entry | null,
  entry: Entry | null,
): Entry | null {
  if (!activeId || loadedId !== activeId) return null
  if (pending?.id === activeId) return pending
  if (entry?.id === activeId) return entry
  return null
}

export function selectLatestEntryRecovery(
  pending: Entry | undefined,
  journal: Entry | undefined,
): Entry | undefined {
  if (!pending) return journal
  if (!journal || pending.updatedAt >= journal.updatedAt) return pending
  return journal
}

export function selectTransitionPending(
  requestedId: string | undefined,
  pending: Entry | null,
  journal: Entry | undefined,
): Entry | null {
  if (pending) return pending
  if (journal && journal.id !== requestedId) return journal
  return null
}

export function selectForeignEntryRecoveries(
  requestedId: string | undefined,
  pending: Entry | null,
  journals: Entry[],
): Entry[] {
  const selected = new Map<string, Entry>()
  for (const journal of journals) {
    if (journal.id !== requestedId) selected.set(journal.id, journal)
  }
  if (pending && pending.id !== requestedId) {
    const journal = selected.get(pending.id)
    selected.set(
      pending.id,
      selectLatestEntryRecovery(pending, journal) ?? pending,
    )
  }
  return [...selected.values()].sort((left, right) => {
    if (left.id < right.id) return -1
    if (left.id > right.id) return 1
    return 0
  })
}
