import { emptyField } from './types'
import type { BinderWork } from './db'

export interface BinderWorkCacheRecord {
  ownerId: string
  bookId: string
  updatedAt: number
  dirty: boolean
  syncedUpdatedAt: number
  work: BinderWork
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Builds only the fields allowed in remote binder_works.data. */
export function normalizeBinderWork(bookId: string, value: unknown): BinderWork {
  const source = isRecord(value) ? (value as Partial<BinderWork>) : {}
  const updatedAt =
    typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
      ? source.updatedAt
      : Date.now()
  return {
    bookId,
    transcription: source.transcription ?? emptyField(),
    notes: source.notes ?? emptyField(),
    pageInputs: source.pageInputs ?? {},
    pageTextBoxes: source.pageTextBoxes ?? {},
    bookmarks: source.bookmarks ?? [],
    ...(typeof source.lastPageNumber === 'number'
      ? { lastPageNumber: source.lastPageNumber }
      : {}),
    checkpointPages: source.checkpointPages ?? {},
    updatedAt,
  }
}

export function toBinderCacheRecord(
  ownerId: string,
  work: BinderWork,
  dirty: boolean,
  syncedUpdatedAt = dirty ? 0 : work.updatedAt,
): BinderWorkCacheRecord {
  const normalized = normalizeBinderWork(work.bookId, work)
  return {
    ownerId,
    bookId: normalized.bookId,
    updatedAt: normalized.updatedAt,
    dirty,
    syncedUpdatedAt,
    work: normalized,
  }
}

export function toRemoteBinderPayload(cache: BinderWorkCacheRecord): BinderWork {
  return normalizeBinderWork(cache.bookId, cache.work)
}

export function shouldReplaceLocalBinderCache(
  local: BinderWorkCacheRecord | undefined,
  remote: BinderWork,
): boolean {
  if (!local) return true
  if (local.dirty) return false
  return local.work.updatedAt <= remote.updatedAt
}

/** Converts either a v7 flat owner record or an already-v8 record to the v8 shape. */
export function migrateBinderCacheRecord(value: unknown): BinderWorkCacheRecord | undefined {
  if (!isRecord(value) || typeof value.ownerId !== 'string') return undefined
  const nested = isRecord(value.work) ? value.work : value
  const bookId =
    typeof nested.bookId === 'string'
      ? nested.bookId
      : typeof value.bookId === 'string'
        ? value.bookId
        : undefined
  if (!bookId) return undefined
  const work = normalizeBinderWork(bookId, nested)
  const dirty = isRecord(value.work) && value.dirty === true
  const syncedUpdatedAt =
    isRecord(value.work) &&
    typeof value.syncedUpdatedAt === 'number' &&
    Number.isFinite(value.syncedUpdatedAt)
      ? value.syncedUpdatedAt
      : work.updatedAt
  return toBinderCacheRecord(value.ownerId, work, dirty, syncedUpdatedAt)
}
