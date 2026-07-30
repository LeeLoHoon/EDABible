import type { Entry, Field, Stroke, TemptationVictory, VerseHighlight } from './types'

export interface EntryJournalStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface EntryJournalRecord {
  version: 2
  entry: Entry
}

export const ENTRY_JOURNAL_KEY = 'edabible:entry-journal:v1'
export const ENTRY_JOURNAL_V2_PREFIX = 'edabible:entry-journal:v2:'
export const ENTRY_JOURNAL_MAX_CHARS = 1_000_000

export type EntryJournalWriteFailure =
  | 'invalid-entry'
  | 'serialization-failed'
  | 'oversize'
  | 'storage-unavailable'

export type EntryJournalWriteResult =
  | { status: 'written'; key: string }
  | { status: 'failed'; reason: EntryJournalWriteFailure }

type SerializedEntryJournalRecord =
  | { status: 'written'; key: string; serialized: string }
  | { status: 'failed'; reason: EntryJournalWriteFailure }

export type EntryJournalReadResult =
  | {
      status: 'available'
      entries: Entry[]
      invalidKeys: string[]
      migrationFailedIds: string[]
    }
  | { status: 'unavailable'; entries: [] }

export type EntryJournalLookupResult =
  | { status: 'found'; entry: Entry }
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'unavailable' }

function storageOrUndefined(storage?: EntryJournalStorage): EntryJournalStorage | undefined {
  if (storage) return storage
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

function journalKey(id: string): string {
  return `${ENTRY_JOURNAL_V2_PREFIX}${encodeURIComponent(id)}`
}

function safeJournalKey(id: string): string | undefined {
  try {
    return journalKey(id)
  } catch {
    return undefined
  }
}

function compareEntryIds(left: Entry, right: Entry): number {
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStroke(value: unknown): value is Stroke {
  if (!isRecord(value) || typeof value.color !== 'string' || !isFiniteTimestamp(value.size)) {
    return false
  }
  return (
    Array.isArray(value.points) &&
    value.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 3 &&
        point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)),
    )
  )
}

function isField(value: unknown): value is Field {
  return (
    isRecord(value) &&
    (value.mode === 'text' || value.mode === 'ink') &&
    typeof value.text === 'string' &&
    Array.isArray(value.strokes) &&
    value.strokes.every(isStroke)
  )
}

function isTemptationVictory(value: unknown): value is TemptationVictory {
  return (
    isRecord(value) &&
    isField(value.sin) &&
    (value.stage === null || isFiniteTimestamp(value.stage)) &&
    isField(value.stageNote) &&
    isField(value.help) &&
    isField(value.pray) &&
    isField(value.victory) &&
    isField(value.grow)
  )
}

function isVerseHighlight(value: unknown): value is VerseHighlight {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    isFiniteTimestamp(value.start) &&
    isFiniteTimestamp(value.end) &&
    (value.color === 'gold' || value.color === 'green' || value.color === 'pink')
  )
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function isEntry(value: unknown): value is Entry {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (!safeJournalKey(value.id)) return false
  if (!isDateKey(value.date) || typeof value.bibleRef !== 'string') return false
  if (!isField(value.transcription) || !isField(value.spousePrayer)) return false
  if (!Array.isArray(value.answers) || !value.answers.every(isField)) return false
  if (!Array.isArray(value.prayerTopics) || !value.prayerTopics.every(isField)) return false
  if (!isTemptationVictory(value.temptationVictory)) return false
  if (!isFiniteTimestamp(value.createdAt) || !isFiniteTimestamp(value.updatedAt)) return false
  if (
    value.questionSet !== undefined &&
    value.questionSet !== 'meditation' &&
    value.questionSet !== 'review'
  ) {
    return false
  }
  if (
    value.prayerTopics2 !== undefined &&
    (!Array.isArray(value.prayerTopics2) || !value.prayerTopics2.every(isField))
  ) {
    return false
  }
  if (value.spousePrayer2 !== undefined && !isField(value.spousePrayer2)) return false
  if (
    value.highlightedVerses !== undefined &&
    (!Array.isArray(value.highlightedVerses) ||
      !value.highlightedVerses.every((item) => typeof item === 'string'))
  ) {
    return false
  }
  if (
    value.highlightRanges !== undefined &&
    (!Array.isArray(value.highlightRanges) || !value.highlightRanges.every(isVerseHighlight))
  ) {
    return false
  }
  return true
}

function parseRecord(raw: string, version: 1 | 2): Entry | undefined {
  if (raw.length > ENTRY_JOURNAL_MAX_CHARS) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== version || !isEntry(parsed.entry)) {
      return undefined
    }
    return parsed.entry
  } catch {
    return undefined
  }
}

function serializeRecord(entry: Entry): SerializedEntryJournalRecord {
  try {
    if (!isEntry(entry)) return { status: 'failed', reason: 'invalid-entry' }
  } catch {
    return { status: 'failed', reason: 'invalid-entry' }
  }
  let serialized: string
  try {
    const record: EntryJournalRecord = { version: 2, entry }
    serialized = JSON.stringify(record)
  } catch {
    return { status: 'failed', reason: 'serialization-failed' }
  }
  if (serialized.length > ENTRY_JOURNAL_MAX_CHARS) {
    return { status: 'failed', reason: 'oversize' }
  }
  const key = safeJournalKey(entry.id)
  if (!key) return { status: 'failed', reason: 'invalid-entry' }
  return { status: 'written', key, serialized }
}

export function writeEntryJournal(
  entry: Entry,
  storage?: EntryJournalStorage,
): EntryJournalWriteResult {
  const serialized = serializeRecord(entry)
  if (serialized.status === 'failed') return serialized
  const target = storageOrUndefined(storage)
  if (!target) return { status: 'failed', reason: 'storage-unavailable' }
  try {
    target.setItem(serialized.key, serialized.serialized)
    return { status: 'written', key: serialized.key }
  } catch {
    return { status: 'failed', reason: 'storage-unavailable' }
  }
}

function restoreRaw(
  storage: EntryJournalStorage,
  key: string,
  previousRaw: string | null,
): void {
  try {
    if (previousRaw === null) {
      storage.removeItem(key)
      return
    }
    storage.setItem(key, previousRaw)
  } catch {
    // The legacy record remains the recovery source when rollback is unavailable.
    return
  }
}

function migrateLegacyRecord(
  storage: EntryJournalStorage,
  legacy: Entry,
  currentV2: Entry | undefined,
  currentV2Raw: string | null,
): boolean {
  const selected =
    currentV2 && currentV2.updatedAt >= legacy.updatedAt ? currentV2 : legacy
  const key = journalKey(legacy.id)
  const serialized = serializeRecord(selected)
  if (serialized.status === 'failed') return false

  let previousRaw = currentV2Raw
  try {
    if (selected === currentV2) {
      const readBack = storage.getItem(key)
      if (
        readBack === null ||
        readBack !== currentV2Raw ||
        parseRecord(readBack, 2)?.id !== selected.id
      ) {
        return false
      }
    } else {
      if (previousRaw === null) previousRaw = storage.getItem(key)
      storage.setItem(key, serialized.serialized)
      const readBack = storage.getItem(key)
      if (readBack !== serialized.serialized || parseRecord(readBack, 2)?.id !== selected.id) {
        restoreRaw(storage, key, previousRaw)
        return false
      }
    }
    storage.removeItem(ENTRY_JOURNAL_KEY)
    return true
  } catch {
    if (selected !== currentV2) restoreRaw(storage, key, previousRaw)
    return false
  }
}

export function readEntryJournals(storage?: EntryJournalStorage): EntryJournalReadResult {
  const target = storageOrUndefined(storage)
  if (!target) return { status: 'unavailable', entries: [] }

  const entries = new Map<string, Entry>()
  const rawById = new Map<string, string>()
  const invalidKeys: string[] = []
  let legacyRaw: string | null
  try {
    const keys: string[] = []
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index)
      if (key?.startsWith(ENTRY_JOURNAL_V2_PREFIX)) keys.push(key)
    }
    keys.sort()
    for (const key of keys) {
      const raw = target.getItem(key)
      if (raw === null) continue
      const entry = parseRecord(raw, 2)
      let decodedId: string | undefined
      try {
        decodedId = decodeURIComponent(key.slice(ENTRY_JOURNAL_V2_PREFIX.length))
      } catch {
        decodedId = undefined
      }
      if (!entry || entry.id !== decodedId) {
        invalidKeys.push(key)
        continue
      }
      entries.set(entry.id, entry)
      rawById.set(entry.id, raw)
    }
    legacyRaw = target.getItem(ENTRY_JOURNAL_KEY)
  } catch {
    return { status: 'unavailable', entries: [] }
  }

  const migrationFailedIds: string[] = []
  if (legacyRaw !== null) {
    const legacy = parseRecord(legacyRaw, 1)
    if (!legacy) {
      invalidKeys.push(ENTRY_JOURNAL_KEY)
    } else {
      const currentV2 = entries.get(legacy.id)
      const selected =
        currentV2 && currentV2.updatedAt >= legacy.updatedAt ? currentV2 : legacy
      entries.set(legacy.id, selected)
      if (!migrateLegacyRecord(target, legacy, currentV2, rawById.get(legacy.id) ?? null)) {
        migrationFailedIds.push(legacy.id)
      }
    }
  }

  return {
    status: 'available',
    entries: [...entries.values()].sort(compareEntryIds),
    invalidKeys,
    migrationFailedIds,
  }
}

export function readEntryJournal(
  id: string,
  storage?: EntryJournalStorage,
): EntryJournalLookupResult {
  const key = safeJournalKey(id)
  if (!key) return { status: 'invalid' }
  const result = readEntryJournals(storage)
  if (result.status === 'unavailable') return { status: 'unavailable' }
  const entry = result.entries.find((candidate) => candidate.id === id)
  if (entry) return { status: 'found', entry }
  if (result.invalidKeys.includes(key)) return { status: 'invalid' }
  return { status: 'empty' }
}

export function shouldRecoverEntryJournal(
  journal: Entry,
  committed: Entry | undefined,
): boolean {
  if (!committed) return true
  return journal.id === committed.id && journal.updatedAt > committed.updatedAt
}

function clearRawRecord(
  storage: EntryJournalStorage,
  key: string,
  version: 1 | 2,
  id: string,
  committedUpdatedAt: number,
): void {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return
    const entry = parseRecord(raw, version)
    if (!entry || entry.id !== id || entry.updatedAt > committedUpdatedAt) return
    storage.removeItem(key)
  } catch {
    // A failed clear is safe: the durable commit will be compared again on recovery.
    return
  }
}

export function clearEntryJournal(
  id: string,
  committedUpdatedAt: number,
  storage?: EntryJournalStorage,
): void {
  const target = storageOrUndefined(storage)
  if (!target) return
  const key = safeJournalKey(id)
  if (!key) return
  clearRawRecord(target, key, 2, id, committedUpdatedAt)
  clearRawRecord(target, ENTRY_JOURNAL_KEY, 1, id, committedUpdatedAt)
}
