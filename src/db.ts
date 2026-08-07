import Dexie, { type Table } from 'dexie'
import { emptyField, isFieldEmpty, type Entry, type Field, type VerseHighlight } from './types'
import { supabase } from './supabase'
import { SerializedSaveQueue } from './serializedSaveQueue'
import { commitEntryInTransaction, type EntryCommitResult } from './entryCommit'
import {
  migrateBinderCacheRecord,
  normalizeBinderWork,
  shouldReplaceLocalBinderCache,
  toBinderCacheRecord,
  toRemoteBinderPayload,
  type BinderWorkCacheRecord,
} from './binderCache'
import {
  shouldInheritAnonymousSermonNote,
  type SermonNoteClaim,
} from './sermonClaim'
import {
  chapterKey,
  highlightRevisionFromResponse,
  highlightRowKey,
  isHighlightPushable,
  isStaleHighlightError,
  normalizeRemoteRanges,
  selectHighlightPulls,
  type ChapterRef,
  type LocalHighlightMeta,
  type RemoteHighlightMeta,
  type VerseHighlightRecord,
} from './verseHighlights'
import {
  applyEntryClaim,
  entryRevisionFromResponse,
  ENTRY_LOCAL_OWNER,
  isDeletedEntryError,
  isEntryPushable,
  isStaleEntryError,
  normalizeRemoteEntry,
  selectEntryPullActions,
  serializeEntry,
  type EntryRecord,
  type LocalEntryMeta,
  type RemoteEntryMeta,
} from './entrySync'

export { normalizeBinderWork } from './binderCache'
export { ENTRY_LOCAL_OWNER } from './entrySync'

export interface BibleIndexCache {
  id: string
  build: string
  items: unknown[]
  updatedAt: string
}

export interface BibleBookCache {
  file: string
  build: string
  doc: unknown
  /**
   * 이 캐시가 반영한 Supabase 본문의 최신 updated_at. 다음 로드 때 이 값만 비교해
   * 바뀐 게 없으면 본문(책 한 권이 수백 KB) 내려받기를 통째로 건너뛴다.
   */
  remoteStamp?: string
  updatedAt: string
}

export interface BinderWork {
  bookId: string
  transcription: Field
  notes: Field
  pageInputs: Record<string, Field>
  pageTextBoxes: Record<string, BinderTextBox[]>
  bookmarks: BinderBookmark[]
  /** 이 권에서 마지막으로 보던 쪽 — 다시 열 때 이어보기용 */
  lastPageNumber?: number
  /** 체크포인트 구간별로 마지막에 보던 쪽 — 체크포인트를 다시 누르면 그 자리로 돌아간다 */
  checkpointPages?: Record<string, number>
  updatedAt: number
}

interface BinderClaim {
  id: string
  ownerId: string
  claimedAt: number
}

/** 로그인 전 묵상을 계정으로 옮긴 기록 — 기기당 한 번만 승계해 중복 업로드를 막는다 */
interface EntryClaim {
  id: string
  ownerId: string
  claimedAt: number
}

/** 세트별 숨긴 원본 PDF 쪽번호의 로컬 캐시. */
export interface BinderHiddenPages {
  setId: string
  pages: number[]
  updatedAt: number
}

/** 쪽 위에 얹는 타이핑 상자 — x·y·width·height는 모두 쪽 크기 대비 비율(0~1) */
export interface BinderTextBox {
  id: string
  x: number
  y: number
  width: number
  /** 없으면 내용에 맞춰 자동 높이 (크기 조절 이전에 만든 상자) */
  height?: number
  text: string
}

export interface BinderBookmark {
  id: string
  page: number
  label: string
  createdAt: number
}

/** 묵상 한 편에 딸린 음성 녹음 — 이 기기(IndexedDB)에만 저장되고 어디에도 올라가지 않는다. */
export interface Recording {
  id: string
  entryId: string
  blob: Blob
  mimeType: string
  durationMs: number
  createdAt: number
}

export type SermonService = 'morning' | 'afternoon'

/** 설교 본문 한 조각. bible.ts의 PassageRef와 같은 장 단위이고, verseLabel은 관리자가
    적은 절 범위 표기('8:28-30')를 표시용으로 보존한다 — 성경 1189장 중 697장에 절 마커가
    없어 본문을 절 단위로 잘라낼 수 없고, 잘라내면 형광펜의 p<블록 인덱스> 키도 밀린다. */
export interface SermonPassage {
  book: string
  chapter: number
  endChapter: number
  verseLabel?: string
}

export interface Sermon {
  id: string
  service: SermonService
  /** 주일 날짜 'YYYY-MM-DD' — sermonWeek.ts가 이 값으로 묵상 기간을 계산한다 */
  preachedOn: string
  title: string
  titleEn?: string
  preacher: string
  preacherEn?: string
  passages: SermonPassage[]
  summary: string
  summaryEn?: string
  points: string[]
  pointsEn?: string[]
  mediaUrl: string
  published: boolean
  updatedAt: number
}

const preservedSermonNoteData: unique symbol = Symbol('preservedSermonNoteData')

/** 교인의 묵상 — sermon_notes.data에 통째로 들어가는 jsonb.
    binder_works와 같은 방식이라 스키마 변경 없이 필드를 늘릴 수 있다. */
export interface SermonNote {
  sermonId: string
  pointAnswers: Field[]
  impression: Field
  application: Field
  freeNote: Field
  /** 메시지성경(기본 역본) 형광펜 — 기존 데이터와의 호환을 위해 이름을 유지한다 */
  highlightRanges: VerseHighlight[]
  /** 다른 역본의 형광펜 — 제거된 역본 key도 사용자 기록 보존을 위해 그대로 둔다 */
  highlightVersions: Record<string, VerseHighlight[]>
  /** 원격 sermon_notes의 optimistic concurrency revision. 로컬 전용 기록은 0이다. */
  revision: number
  updatedAt: number
  [preservedSermonNoteData]?: Map<string, unknown>
}

/** 로컬 캐시 레코드 — 한 기기를 여러 계정이 함께 쓸 때 묵상이 섞이지 않도록 사용자별로 키를 나눈다 */
interface SermonNoteCache extends SermonNote {
  key: string
  userId: string
  preservedEntries?: Array<[string, unknown]>
  dirty?: boolean
  conflict?: boolean
  baseRevision?: number
}

/** 로컬(IndexedDB) 저장소 — 묵상 노트 저장 및 바인더 오프라인 캐시. */
class EdaBibleDB extends Dexie {
  entries!: Table<EntryRecord, string>
  bibleIndex!: Table<BibleIndexCache, string>
  bibleBooks!: Table<BibleBookCache, string>
  binderWorks!: Table<BinderWork, string>
  binderWorksByOwner!: Table<BinderWorkCacheRecord, [string, string]>
  binderClaims!: Table<BinderClaim, string>
  entryClaims!: Table<EntryClaim, string>
  /** 성경 본문에 귀속된 형광펜 — 역본 × 장 단위, 모든 묵상·설교가 공유한다 */
  verseHighlights!: Table<VerseHighlightRecord & { key: string }, string>
  binderHiddenPages!: Table<BinderHiddenPages, string>
  recordings!: Table<Recording, string>
  sermons!: Table<Sermon, string>
  sermonNotes!: Table<SermonNoteCache, string>
  sermonNoteClaims!: Table<SermonNoteClaim, string>

  constructor() {
    super('edabible')
    this.version(1).stores({
      // id: 기본키, date/updatedAt: 정렬·조회용 인덱스
      entries: 'id, date, updatedAt',
    })
    this.version(2).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
    })
    this.version(3).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
    })
    this.version(4).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
      recordings: 'id, entryId, createdAt',
    })
    this.version(5).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
      recordings: 'id, entryId, createdAt',
      binderHiddenPages: 'setId, updatedAt',
    })
    this.version(6).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
      recordings: 'id, entryId, createdAt',
      binderHiddenPages: 'setId, updatedAt',
      sermons: 'id, preachedOn, updatedAt',
      sermonNotes: 'key, sermonId, updatedAt',
    })
    this.version(7).stores({
      entries: 'id, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
      binderWorksByOwner: '[ownerId+bookId], ownerId, updatedAt',
      binderClaims: 'id',
      recordings: 'id, entryId, createdAt',
      binderHiddenPages: 'setId, updatedAt',
      sermons: 'id, preachedOn, updatedAt',
      sermonNotes: 'key, sermonId, updatedAt',
    })
    this.version(8)
      .stores({
        entries: 'id, date, updatedAt',
        bibleIndex: 'id, build',
        bibleBooks: 'file, build',
        binderWorks: 'bookId, updatedAt',
        binderWorksByOwner: '[ownerId+bookId], ownerId, updatedAt',
        binderClaims: 'id',
        recordings: 'id, entryId, createdAt',
        binderHiddenPages: 'setId, updatedAt',
        sermons: 'id, preachedOn, updatedAt',
        sermonNotes: 'key, sermonId, updatedAt',
        sermonNoteClaims: 'sermonId',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('binderWorksByOwner')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const migrated = migrateBinderCacheRecord(row)
            if (!migrated) return
            for (const key of Object.keys(row)) delete row[key]
            Object.assign(row, migrated)
          })
      })
    // v9: 묵상에 소유자·동기화 메타를 붙인다. 기존 묵상은 전부 로컬 소유로 표시해 두고
    // 로그인 시 claimLocalEntries가 계정으로 옮긴다(dirty=true라 그대로 업로드된다).
    this.version(9)
      .stores({
        entries: 'id, ownerId, date, updatedAt',
        bibleIndex: 'id, build',
        bibleBooks: 'file, build',
        binderWorks: 'bookId, updatedAt',
        binderWorksByOwner: '[ownerId+bookId], ownerId, updatedAt',
        binderClaims: 'id',
        entryClaims: 'id',
        recordings: 'id, entryId, createdAt',
        binderHiddenPages: 'setId, updatedAt',
        sermons: 'id, preachedOn, updatedAt',
        sermonNotes: 'key, sermonId, updatedAt',
        sermonNoteClaims: 'sermonId',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('entries')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            row.ownerId = ENTRY_LOCAL_OWNER
            row.revision = 0
            row.dirty = true
            row.conflict = false
          })
      })
    // v10: 형광펜을 묵상에서 떼어 본문(역본 × 장)에 귀속시킨다. 기존 노트 안의 밑줄은
    // 상대 좌표라 옮길 수 없어 그대로 남겨 두고(읽지 않는다) 여기서는 빈 채로 시작한다.
    this.version(10).stores({
      entries: 'id, ownerId, date, updatedAt',
      bibleIndex: 'id, build',
      bibleBooks: 'file, build',
      binderWorks: 'bookId, updatedAt',
      binderWorksByOwner: '[ownerId+bookId], ownerId, updatedAt',
      binderClaims: 'id',
      entryClaims: 'id',
      verseHighlights: 'key, [ownerId+version], ownerId, updatedAt',
      recordings: 'id, entryId, createdAt',
      binderHiddenPages: 'setId, updatedAt',
      sermons: 'id, preachedOn, updatedAt',
      sermonNotes: 'key, sermonId, updatedAt',
      sermonNoteClaims: 'sermonId',
    })
  }
}

export const db = new EdaBibleDB()

const binderSaveQueue = new SerializedSaveQueue()
const sermonSaveQueue = new SerializedSaveQueue()
const entrySaveQueue = new SerializedSaveQueue()
const highlightSaveQueue = new SerializedSaveQueue()

export const BINDER_LOCAL_OWNER = 'local'
const BINDER_LEGACY_CLAIM_ID = 'legacy-binder-works:v1'
const ENTRY_LOCAL_CLAIM_ID = 'local-entries:v1'
/** 원격 본문을 한 번에 받아올 묶음 크기 — 손글씨 획까지 담겨 있어 크게 잡지 않는다 */
const ENTRY_FETCH_CHUNK = 10

const REMOVED_BIBLE_CACHE_PRUNE_KEY = 'edabible:cache-pruned:removed-nkt:v1'

/**
 * 제거된 역본의 본문 cache만 한 번 지운다. sermon note의 과거 highlightVersions.nkt는
 * 사용자 데이터이므로 이 migration에서 읽거나 수정하지 않는다.
 */
export async function pruneRemovedBibleVersionCaches(): Promise<void> {
  try {
    if (localStorage.getItem(REMOVED_BIBLE_CACHE_PRUNE_KEY) === 'done') return
  } catch (error) {
    console.warn('Bible cache migration marker could not be read.', error)
  }

  await db.transaction('rw', db.bibleIndex, db.bibleBooks, async () => {
    await db.bibleIndex.delete('index:nkt')
    await db.bibleBooks.filter((record) => record.file.startsWith('nkt/')).delete()
  })

  try {
    localStorage.setItem(REMOVED_BIBLE_CACHE_PRUNE_KEY, 'done')
  } catch (error) {
    console.warn('Bible cache migration marker could not be saved.', error)
  }
}

/**
 * 편집 결과에 동기화 메타를 붙인다. 소유자가 바뀐 행(로그인 전 로컬 → 계정)은 계정에
 * 처음 올리는 것이므로 revision 0에서 다시 시작한다.
 */
function withEntrySyncMeta(
  entry: Entry,
  ownerId: string,
  current: EntryRecord | undefined,
): EntryRecord {
  const sameOwner = current?.ownerId === ownerId
  return {
    ...entry,
    ownerId,
    revision: sameOwner ? current.revision : 0,
    dirty: true,
    conflict: sameOwner ? current.conflict === true : false,
  }
}

/** 다른 계정의 묵상은 열어주지 않는다 — 한 기기를 여러 계정이 함께 쓸 수 있다. */
export async function getEntry(id: string, ownerId: string): Promise<Entry | undefined> {
  const record = await db.entries.get(id)
  if (!record || record.ownerId !== ownerId) return undefined
  return record
}

export async function putEntry(entry: Entry, ownerId: string): Promise<void> {
  await db.transaction('rw', db.entries, async () => {
    const current = await db.entries.get(entry.id)
    await db.entries.put(withEntrySyncMeta(entry, ownerId, current))
  })
}

export async function commitEntrySnapshot(
  snapshot: Entry,
  ownerId: string,
): Promise<EntryCommitResult> {
  return db.transaction('rw', db.entries, () => {
    let current: EntryRecord | undefined
    return commitEntryInTransaction(
      {
        get: async (id) => {
          current = await db.entries.get(id)
          return current?.ownerId === ownerId ? current : undefined
        },
        put: async (entry) => {
          await db.entries.put(withEntrySyncMeta(entry, ownerId, current))
        },
      },
      snapshot,
    )
  })
}

export async function deleteEntry(id: string, ownerId: string): Promise<void> {
  await db.entries.delete(id)
  await deleteRemoteEntry(id, ownerId)
}

/** 이 계정의 묵상 전체 삭제 */
export async function clearAllEntries(ownerId: string): Promise<void> {
  // 지울 대상은 id만 있으면 된다 — 본문까지 읽으면 손글씨가 쌓인 기기에서 메모리가 크게 튄다.
  const ids = (await db.entries
    .where('ownerId')
    .equals(ownerId)
    .primaryKeys()) as string[]
  await db.entries.bulkDelete(ids)
  await Promise.all(ids.map((id) => deleteRemoteEntry(id, ownerId)))
}

/** 이 계정의 묵상 목록 (최신순) */
export async function listEntries(ownerId: string): Promise<Entry[]> {
  const rows = await db.entries.where('ownerId').equals(ownerId).sortBy('updatedAt')
  return rows.reverse()
}

async function verifyEntrySessionOwner(userId: string): Promise<void> {
  // Defense-in-depth only. SQL validates p_owner_user_id against auth.uid() at the write boundary.
  await assertActiveSupabaseOwner(userId, 'MEDITATION_ENTRY_OWNER_CHANGED')
}

/** 로컬에서 지운 묵상을 원격에도 tombstone으로 남긴다 — 없으면 다른 기기에서 되살아난다. */
async function deleteRemoteEntry(entryId: string, ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const client = supabase
  await entrySaveQueue.run(`${ownerId}:${entryId}`, async () => {
    await verifyEntrySessionOwner(ownerId)
    const { error } = await client.rpc('delete_meditation_entry', { p_entry_id: entryId })
    if (error) throw error
  })
}

/**
 * 한 건을 원격에 올린다. 성공하면 서버가 확정한 revision을 로컬에 반영하고, revision이
 * 어긋나면(다른 기기가 먼저 저장) conflict로 표시해 자동 재시도를 멈춘다.
 */
export async function pushEntry(entryId: string, ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const client = supabase
  const record = await db.entries.get(entryId)
  if (!record || !isEntryPushable(record, ownerId)) return

  await entrySaveQueue.run(`${ownerId}:${entryId}`, async () => {
    try {
      await verifyEntrySessionOwner(ownerId)
      const { data, error } = await client.rpc('put_meditation_entry', {
        p_owner_user_id: ownerId,
        p_entry_id: record.id,
        p_expected_revision: record.revision,
        p_data: serializeEntry(record),
      })
      if (error) throw error
      const revision = entryRevisionFromResponse(data)
      await db.transaction('rw', db.entries, async () => {
        const latest = await db.entries.get(record.id)
        if (!latest || latest.ownerId !== ownerId) return
        // 전송하는 사이에 더 편집됐으면 dirty를 유지해 다음 flush가 이어서 올린다.
        await db.entries.put({
          ...latest,
          revision,
          dirty: latest.updatedAt > record.updatedAt,
          conflict: false,
        })
      })
    } catch (error) {
      const blocked = isStaleEntryError(error) || isDeletedEntryError(error)
      await db.transaction('rw', db.entries, async () => {
        const latest = await db.entries.get(record.id)
        if (!latest || latest.ownerId !== ownerId) return
        await db.entries.put({
          ...latest,
          dirty: true,
          conflict: blocked || latest.conflict === true,
        })
      })
      throw error
    }
  })
}

/** 아직 못 올린 묵상을 한꺼번에 재전송한다 — 앱 진입·온라인 복귀 시점에 부른다. */
export async function flushDirtyEntries(ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  // 커서로 훑으며 id만 모은다. 본문을 배열로 받으면 올릴 묵상 전체가 한꺼번에 메모리에 남는다.
  const pendingIds: string[] = []
  await db.entries
    .where('ownerId')
    .equals(ownerId)
    .each((record) => {
      if (isEntryPushable(record, ownerId)) pendingIds.push(record.id)
    })

  for (const entryId of pendingIds) {
    try {
      await pushEntry(entryId, ownerId)
    } catch (error) {
      // 오프라인·일시 오류면 dirty가 남아 다음 기회에 다시 올라간다.
      console.warn('Meditation entry upload failed; it stays queued.', error)
    }
  }
}

function toRemoteEntryMeta(rows: unknown): RemoteEntryMeta[] {
  if (!Array.isArray(rows)) return []
  const metas: RemoteEntryMeta[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const source = row as { entry_id?: unknown; revision?: unknown; deleted_at?: unknown }
    if (typeof source.entry_id !== 'string') continue
    metas.push({
      entryId: source.entry_id,
      revision:
        typeof source.revision === 'number' && Number.isInteger(source.revision)
          ? source.revision
          : 0,
      deleted: source.deleted_at !== null && source.deleted_at !== undefined,
    })
  }
  return metas
}

/**
 * 원격에서 이 계정의 묵상을 내려받아 로컬을 맞춘다. 목록은 메타만 받고, 실제 본문은
 * 로컬에 없거나 뒤처진 것만 골라 가져온다.
 */
export async function pullEntries(ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const client = supabase
  const { data, error } = await client.rpc('list_my_meditation_entries')
  if (error) throw error

  // 대조에 필요한 건 revision·dirty뿐이다. 커서로 훑으며 그것만 남기고 본문은 흘려보낸다.
  const local = new Map<string, LocalEntryMeta>()
  await db.entries
    .where('ownerId')
    .equals(ownerId)
    .each((record) => {
      local.set(record.id, { revision: record.revision, dirty: record.dirty })
    })
  const actions = selectEntryPullActions(toRemoteEntryMeta(data), local)

  const dropped = actions.filter((action) => action.kind === 'drop').map((action) => action.entryId)
  if (dropped.length > 0) await db.entries.bulkDelete(dropped)

  const wanted = actions.filter((action) => action.kind === 'fetch').map((action) => action.entryId)
  for (let index = 0; index < wanted.length; index += ENTRY_FETCH_CHUNK) {
    const chunk = wanted.slice(index, index + ENTRY_FETCH_CHUNK)
    const { data: rows, error: fetchError } = await client
      .from('meditation_entries')
      .select('entry_id, data, revision')
      .eq('user_id', ownerId)
      .in('entry_id', chunk)
    if (fetchError) throw fetchError

    for (const row of rows ?? []) {
      const entry = normalizeRemoteEntry(String(row.entry_id), row.data)
      if (!entry) continue
      const revision =
        typeof row.revision === 'number' && Number.isInteger(row.revision) ? row.revision : 0
      await db.transaction('rw', db.entries, async () => {
        const latest = await db.entries.get(entry.id)
        // 받아오는 사이에 편집이 들어왔으면 로컬을 지킨다 — push가 이어서 올린다.
        if (latest?.dirty) return
        await db.entries.put({ ...entry, ownerId, revision, dirty: false, conflict: false })
      })
    }
  }
}

/**
 * 로그인 전에 이 기기에 쌓인 묵상을 계정으로 옮긴다. 기기당 한 번만 수행해
 * 계정을 바꿔 로그인해도 같은 묵상이 여러 계정에 복제되지 않게 한다.
 */
export async function claimLocalEntries(ownerId: string): Promise<number> {
  if (ownerId === ENTRY_LOCAL_OWNER) return 0
  let claimed = 0
  await db.transaction('rw', db.entries, db.entryClaims, async () => {
    if (await db.entryClaims.get(ENTRY_LOCAL_CLAIM_ID)) return
    await db.entryClaims.put({
      id: ENTRY_LOCAL_CLAIM_ID,
      ownerId,
      claimedAt: Date.now(),
    })
    // 커서로 제자리 수정한다 — toArray()+bulkPut이면 이 기기의 묵상 본문 전체가 한꺼번에
    // 메모리에 올라가고, 손글씨 필사가 쌓인 기기에서는 그것만으로 화면이 멎는다.
    claimed = await db.entries
      .where('ownerId')
      .equals(ENTRY_LOCAL_OWNER)
      .modify((record) => {
        applyEntryClaim(record, ownerId)
      })
  })
  return claimed
}

/** 이 묵상에 해결하지 않은 저장 충돌이 있는지 */
export async function hasEntryConflict(id: string, ownerId: string): Promise<boolean> {
  const record = await db.entries.get(id)
  return record?.ownerId === ownerId && record.conflict === true
}

/** 충돌 배너에서 "내 것 유지"를 고른 경우 — 원격 revision 위에 로컬 내용을 덮어쓴다. */
export async function resolveEntryConflictKeepLocal(id: string, ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) throw new Error('MEDITATION_ENTRY_OWNER_CHANGED')
  const client = supabase
  const record = await db.entries.get(id)
  if (!record || record.ownerId !== ownerId) throw new Error('MEDITATION_ENTRY_OWNER_CHANGED')

  await entrySaveQueue.run(`${ownerId}:${id}`, async () => {
    await verifyEntrySessionOwner(ownerId)
    const { data: remote, error: revisionError } = await client
      .from('meditation_entries')
      .select('revision')
      .eq('user_id', ownerId)
      .eq('entry_id', id)
      .maybeSingle()
    if (revisionError) throw revisionError
    const expectedRevision =
      typeof remote?.revision === 'number' && Number.isInteger(remote.revision)
        ? remote.revision
        : 0

    await verifyEntrySessionOwner(ownerId)
    const { data, error } = await client.rpc('put_meditation_entry', {
      p_owner_user_id: ownerId,
      p_entry_id: id,
      p_expected_revision: expectedRevision,
      p_data: serializeEntry(record),
    })
    if (error) throw error
    const revision = entryRevisionFromResponse(data)
    await db.transaction('rw', db.entries, async () => {
      const latest = await db.entries.get(id)
      if (!latest || latest.ownerId !== ownerId) return
      await db.entries.put({
        ...latest,
        revision,
        dirty: latest.updatedAt > record.updatedAt,
        conflict: false,
      })
    })
  })
}

/** 충돌 배너에서 "다시 불러오기"를 고른 경우 — 로컬 편집을 버리고 원격으로 되돌린다. */
export async function resolveEntryConflictUseRemote(
  id: string,
  ownerId: string,
): Promise<Entry | undefined> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) throw new Error('MEDITATION_ENTRY_OWNER_CHANGED')
  await verifyEntrySessionOwner(ownerId)
  const { data, error } = await supabase
    .from('meditation_entries')
    .select('data, revision, deleted_at')
    .eq('user_id', ownerId)
    .eq('entry_id', id)
    .maybeSingle()
  if (error) throw error

  // 다른 기기에서 지운 묵상이면 이쪽에서도 없앤다.
  if (!data || data.deleted_at) {
    await db.entries.delete(id)
    return undefined
  }

  const entry = normalizeRemoteEntry(id, data.data)
  if (!entry) throw new Error('MEDITATION_ENTRY_INVALID_RESPONSE')
  const revision =
    typeof data.revision === 'number' && Number.isInteger(data.revision) ? data.revision : 0
  const restored: EntryRecord = { ...entry, ownerId, revision, dirty: false, conflict: false }
  await db.entries.put(restored)
  return restored
}

/* ── 형광펜: 성경 본문(역본 × 장)에 귀속되어 모든 묵상·설교가 공유한다 ── */

async function verifyHighlightSessionOwner(userId: string): Promise<void> {
  await assertActiveSupabaseOwner(userId, 'VERSE_HIGHLIGHT_OWNER_CHANGED')
}

/** 화면에 띄운 본문이 걸친 장들의 밑줄을 한 번에 읽는다 */
export async function getChapterHighlights(
  ownerId: string,
  version: string,
  refs: readonly ChapterRef[],
): Promise<Map<string, VerseHighlight[]>> {
  const result = new Map<string, VerseHighlight[]>()
  if (refs.length === 0) return result

  const rows = await db.verseHighlights.bulkGet(
    refs.map((ref) => highlightRowKey(ownerId, version, ref)),
  )
  for (const row of rows) {
    if (!row || row.ranges.length === 0) continue
    result.set(chapterKey(row), row.ranges)
  }
  return result
}

/**
 * 한 장의 밑줄을 통째로 갈아 끼운다. 로컬에 먼저 확정하고(오프라인에서도 남는다)
 * 계정 소유일 때만 원격에 올린다.
 */
export async function saveChapterHighlights(
  ownerId: string,
  version: string,
  ref: ChapterRef,
  ranges: readonly VerseHighlight[],
): Promise<void> {
  const key = highlightRowKey(ownerId, version, ref)
  await db.transaction('rw', db.verseHighlights, async () => {
    const current = await db.verseHighlights.get(key)
    await db.verseHighlights.put({
      key,
      ownerId,
      version,
      bookOrder: ref.bookOrder,
      chapter: ref.chapter,
      ranges: [...ranges],
      revision: current?.revision ?? 0,
      dirty: true,
      conflict: current?.conflict === true,
      updatedAt: Date.now(),
    })
  })
  await pushVerseHighlights(ownerId, version, ref).catch((error) => {
    // 오프라인·일시 오류면 dirty가 남아 다음 기회에 올라간다
    console.warn('Verse highlight upload failed; it stays queued.', error)
  })
}

/** 한 장을 원격에 올린다 — revision이 어긋나면 conflict로 표시하고 자동 재시도를 멈춘다 */
export async function pushVerseHighlights(
  ownerId: string,
  version: string,
  ref: ChapterRef,
): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const client = supabase
  const key = highlightRowKey(ownerId, version, ref)
  const record = await db.verseHighlights.get(key)
  if (!record || !isHighlightPushable(record, ownerId)) return

  await highlightSaveQueue.run(key, async () => {
    try {
      await verifyHighlightSessionOwner(ownerId)
      const { data, error } = await client.rpc('put_verse_highlights', {
        p_owner_user_id: ownerId,
        p_version: version,
        p_book_order: ref.bookOrder,
        p_chapter: ref.chapter,
        p_expected_revision: record.revision,
        p_ranges: record.ranges,
      })
      if (error) throw error
      const revision = highlightRevisionFromResponse(data)
      await db.transaction('rw', db.verseHighlights, async () => {
        const latest = await db.verseHighlights.get(key)
        if (!latest) return
        // 올리는 사이에 더 칠했으면 dirty를 유지해 다음 flush가 이어서 올린다
        await db.verseHighlights.put({
          ...latest,
          revision,
          dirty: latest.updatedAt > record.updatedAt,
          conflict: false,
        })
      })
    } catch (error) {
      const stale = isStaleHighlightError(error)
      await db.transaction('rw', db.verseHighlights, async () => {
        const latest = await db.verseHighlights.get(key)
        if (!latest) return
        await db.verseHighlights.put({
          ...latest,
          dirty: true,
          conflict: stale || latest.conflict === true,
        })
      })
      throw error
    }
  })
}

/** 아직 못 올린 밑줄을 한꺼번에 재전송한다 */
export async function flushDirtyHighlights(ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const pending: Array<{ version: string; ref: ChapterRef }> = []
  await db.verseHighlights
    .where('ownerId')
    .equals(ownerId)
    .each((record) => {
      if (isHighlightPushable(record, ownerId)) {
        pending.push({
          version: record.version,
          ref: { bookOrder: record.bookOrder, chapter: record.chapter },
        })
      }
    })

  for (const item of pending) {
    try {
      await pushVerseHighlights(ownerId, item.version, item.ref)
    } catch (error) {
      console.warn('Verse highlight upload failed; it stays queued.', error)
    }
  }
}

function toRemoteHighlightMeta(rows: unknown): RemoteHighlightMeta[] {
  if (!Array.isArray(rows)) return []
  const metas: RemoteHighlightMeta[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const source = row as {
      version?: unknown
      book_order?: unknown
      chapter?: unknown
      revision?: unknown
    }
    if (typeof source.version !== 'string') continue
    if (!Number.isInteger(source.book_order) || !Number.isInteger(source.chapter)) continue
    metas.push({
      version: source.version,
      bookOrder: source.book_order as number,
      chapter: source.chapter as number,
      revision: Number.isInteger(source.revision) ? (source.revision as number) : 0,
    })
  }
  return metas
}

/** 원격에서 이 계정의 밑줄을 내려받아 로컬을 맞춘다 — 뒤처진 장만 골라 받는다 */
export async function pullVerseHighlights(ownerId: string): Promise<void> {
  if (!supabase || ownerId === ENTRY_LOCAL_OWNER) return
  const client = supabase
  const { data, error } = await client.rpc('list_my_verse_highlights')
  if (error) throw error

  const local = new Map<string, LocalHighlightMeta>()
  await db.verseHighlights
    .where('ownerId')
    .equals(ownerId)
    .each((record) => {
      local.set(highlightRowKey(ownerId, record.version, record), {
        revision: record.revision,
        dirty: record.dirty,
      })
    })

  const wanted = selectHighlightPulls(toRemoteHighlightMeta(data), local, ownerId)
  for (const meta of wanted) {
    const { data: rows, error: fetchError } = await client
      .from('verse_highlights')
      .select('ranges, revision')
      .eq('user_id', ownerId)
      .eq('version', meta.version)
      .eq('book_order', meta.bookOrder)
      .eq('chapter', meta.chapter)
      .maybeSingle()
    if (fetchError) throw fetchError
    if (!rows) continue

    const key = highlightRowKey(ownerId, meta.version, meta)
    const ranges = normalizeRemoteRanges(rows.ranges)
    const revision =
      typeof rows.revision === 'number' && Number.isInteger(rows.revision) ? rows.revision : 0
    await db.transaction('rw', db.verseHighlights, async () => {
      const latest = await db.verseHighlights.get(key)
      // 받아오는 사이에 칠했으면 로컬을 지킨다 — push가 이어서 올린다
      if (latest?.dirty) return
      await db.verseHighlights.put({
        key,
        ownerId,
        version: meta.version,
        bookOrder: meta.bookOrder,
        chapter: meta.chapter,
        ranges,
        revision,
        dirty: false,
        conflict: false,
        updatedAt: Date.now(),
      })
    })
  }
}

export async function listRecordings(entryId: string): Promise<Recording[]> {
  const items = await db.recordings.where('entryId').equals(entryId).toArray()
  return items.sort((a, b) => a.createdAt - b.createdAt)
}

export async function addRecording(rec: Recording): Promise<void> {
  await db.recordings.put(rec)
}

export async function deleteRecording(id: string): Promise<void> {
  await db.recordings.delete(id)
}

/** 기존 bookId-only cache는 최초 authenticated owner 한 명에게만 원자적으로 귀속한다. */
export async function claimLegacyBinderWorks(ownerId: string): Promise<void> {
  if (!ownerId || ownerId === BINDER_LOCAL_OWNER) return
  await db.transaction(
    'rw',
    db.binderWorks,
    db.binderWorksByOwner,
    db.binderClaims,
    async () => {
      if (await db.binderClaims.get(BINDER_LEGACY_CLAIM_ID)) return
      const legacy = await db.binderWorks.toArray()
      const owned = await db.binderWorksByOwner.where('ownerId').equals(ownerId).toArray()
      const existing = new Set(owned.map((work) => work.bookId))
      const additions = legacy
        .filter((work) => !existing.has(work.bookId))
        .map((work) => toBinderCacheRecord(ownerId, normalizeBinderWork(work.bookId, work), false))
      if (additions.length > 0) await db.binderWorksByOwner.bulkPut(additions)
      await db.binderClaims.put({
        id: BINDER_LEGACY_CLAIM_ID,
        ownerId,
        claimedAt: Date.now(),
      })
    },
  )
}

export async function isLegacyBinderClaimOwner(ownerId: string): Promise<boolean> {
  const claim = await db.binderClaims.get(BINDER_LEGACY_CLAIM_ID)
  return claim?.ownerId === ownerId
}

export async function assertActiveSupabaseOwner(
  ownerId: string,
  errorCode: string,
): Promise<void> {
  if (!supabase) throw new Error(errorCode)
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.user.id || data.session.user.id !== ownerId) {
    throw new Error(errorCode)
  }
}

export function createBinderWork(bookId: string): BinderWork {
  return {
    bookId,
    transcription: emptyField(),
    notes: emptyField(),
    pageInputs: {},
    pageTextBoxes: {},
    bookmarks: [],
    checkpointPages: {},
    updatedAt: Date.now(),
  }
}

export async function getBinderWork(bookId: string, userId?: string): Promise<BinderWork> {
  const ownerId = userId ?? BINDER_LOCAL_OWNER
  const local = await db.binderWorksByOwner.get([ownerId, bookId])
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('binder_works')
        .select('data')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .maybeSingle()

      if (error) throw error
      if (data?.data) {
        const remote = normalizeBinderWork(bookId, data.data)
        let resolved = remote
        await db.transaction('rw', db.binderWorksByOwner, async () => {
          const latestLocal = await db.binderWorksByOwner.get([ownerId, bookId])
          if (!shouldReplaceLocalBinderCache(latestLocal, remote)) {
            resolved = latestLocal?.work ?? remote
            return
          }
          await db.binderWorksByOwner.put(toBinderCacheRecord(ownerId, remote, false))
        })
        return resolved
      }
    } catch (error) {
      // 오프라인/일시 오류 시 로컬 캐시로 폴백 — 바인더가 아예 안 열리는 것 방지
      console.warn('Binder remote load failed; using owner-scoped cache.', error)
    }
  }

  const latestLocal = await db.binderWorksByOwner.get([ownerId, bookId])
  return normalizeBinderWork(bookId, latestLocal?.work ?? local?.work)
}

/** 계정에서 가장 최근에 사용한 권의 bookId — 선택 필터를 만족하는 기록이 없으면 undefined */
export async function getLastBinderBookId(
  userId?: string,
  isKnown?: (id: string) => boolean,
): Promise<string | undefined> {
  const ownerId = userId ?? BINDER_LOCAL_OWNER
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('binder_works')
        .select('book_id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(20)
      if (!error && data) {
        const matched = data.find((row) => !isKnown || isKnown(row.book_id as string))
        if (matched?.book_id) return matched.book_id as string
      }
    } catch (error) {
      // 네트워크 실패 시 로컬 캐시로 폴백
      console.warn('Last Binder work lookup failed; using owner-scoped cache.', error)
    }
  }

  const localWorks = await db.binderWorksByOwner.where('ownerId').equals(ownerId).sortBy('updatedAt')
  localWorks.reverse()
  return localWorks.find((work) => !isKnown || isKnown(work.bookId))?.bookId
}

export async function putBinderWork(work: BinderWork, userId?: string): Promise<void> {
  const ownerId = userId ?? BINDER_LOCAL_OWNER
  let staged: BinderWorkCacheRecord | undefined
  await db.transaction('rw', db.binderWorksByOwner, async () => {
    const local = await db.binderWorksByOwner.get([ownerId, work.bookId])
    const normalized = normalizeBinderWork(work.bookId, work)
    const next = {
      ...normalized,
      updatedAt: Math.max(Date.now(), normalized.updatedAt, (local?.work.updatedAt ?? 0) + 1),
    }
    staged = toBinderCacheRecord(
      ownerId,
      next,
      userId !== undefined,
      local?.syncedUpdatedAt ?? 0,
    )
    await db.binderWorksByOwner.put(staged)
  })
  if (!staged) throw new Error('BINDER_LOCAL_STAGE_FAILED')

  if (!supabase || !userId) {
    return
  }
  const client = supabase
  const pending = staged

  await binderSaveQueue.run(`${userId}:${pending.bookId}`, async () => {
    await assertActiveSupabaseOwner(userId, 'BINDER_OWNER_CHANGED')
    const payload = toRemoteBinderPayload(pending)
    const { error } = await client.from('binder_works').upsert({
      user_id: userId,
      book_id: payload.bookId,
      data: payload,
      updated_at: new Date(payload.updatedAt).toISOString(),
    })
    if (error) throw error
    await db.transaction('rw', db.binderWorksByOwner, async () => {
      const latest = await db.binderWorksByOwner.get([ownerId, payload.bookId])
      if (!latest || latest.work.updatedAt > payload.updatedAt) return
      await db.binderWorksByOwner.put({
        ...latest,
        dirty: false,
        syncedUpdatedAt: payload.updatedAt,
      })
    })
  })
}

function normalizeHiddenPages(pages: unknown): number[] {
  if (!Array.isArray(pages)) return []
  return [...new Set(pages.filter((page): page is number => Number.isInteger(page) && page >= 1))].sort(
    (a, b) => a - b,
  )
}

/** 세트의 숨긴 원본 PDF 쪽번호를 Supabase에서 읽고, 실패하면 Dexie 캐시로 폴백한다. */
export async function getHiddenPages(setId: string): Promise<number[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('binder_hidden_pages')
        .select('pages')
        .eq('set_id', setId)
        .maybeSingle()

      if (error) throw error
      const pages = normalizeHiddenPages(data?.pages)
      await db.binderHiddenPages.put({ setId, pages, updatedAt: Date.now() })
      return pages
    } catch {
      // 오프라인/일시 오류 시 마지막 전역 숨김 캐시를 사용해 바인더 열람을 유지한다.
    }
  }

  const cached = await db.binderHiddenPages.get(setId)
  return normalizeHiddenPages(cached?.pages)
}

/** 세트의 숨긴 원본 PDF 쪽번호를 정규화해 Supabase와 Dexie 캐시에 저장한다. */
export async function putHiddenPages(setId: string, pages: number[], userId: string): Promise<void> {
  const normalized = normalizeHiddenPages(pages)
  const updatedAt = Date.now()
  if (supabase && userId) {
    const { error } = await supabase.from('binder_hidden_pages').upsert({
      set_id: setId,
      pages: normalized,
      updated_at: new Date(updatedAt).toISOString(),
    })
    if (error) throw error
  }

  await db.binderHiddenPages.put({ setId, pages: normalized, updatedAt })
}

/** 사용자가 바인더 숨김 쪽을 관리할 수 있는지 확인하며, 조회 실패 시 false를 반환한다. */
export async function isBinderAdmin(userId: string): Promise<boolean> {
  if (!supabase || !userId) return false

  try {
    const { data, error } = await supabase
      .from('binder_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    return !error && data !== null
  } catch {
    return false
  }
}

/** 사용자가 주일 설교를 등록할 수 있는지 확인하며, 조회 실패 시 false를 반환한다. */
export async function isSermonAdmin(userId: string): Promise<boolean> {
  if (!supabase || !userId) return false

  try {
    const { data, error } = await supabase
      .from('sermon_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    return !error && data !== null
  } catch {
    return false
  }
}

function normalizePassages(value: unknown): SermonPassage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const raw = item as Partial<SermonPassage>
    const chapter = Number(raw.chapter)
    if (typeof raw.book !== 'string' || !raw.book || !Number.isInteger(chapter) || chapter < 1) return []
    const endChapter = Number(raw.endChapter)
    return [
      {
        book: raw.book,
        chapter,
        endChapter: Number.isInteger(endChapter) && endChapter >= chapter ? endChapter : chapter,
        ...(typeof raw.verseLabel === 'string' && raw.verseLabel ? { verseLabel: raw.verseLabel } : {}),
      },
    ]
  })
}

function normalizePoints(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

interface SermonRow {
  id: string
  service: string
  preached_on: string
  title: string
  title_en: string | null
  preacher: string | null
  preacher_en: string | null
  passages: unknown
  summary: string | null
  summary_en: string | null
  points: unknown
  points_en: unknown
  media_url: string | null
  published: boolean
  updated_at: string
}

function rowToSermon(row: SermonRow): Sermon {
  return {
    id: row.id,
    service: row.service === 'afternoon' ? 'afternoon' : 'morning',
    preachedOn: row.preached_on,
    title: row.title ?? '',
    ...(row.title_en ? { titleEn: row.title_en } : {}),
    preacher: row.preacher ?? '',
    ...(row.preacher_en ? { preacherEn: row.preacher_en } : {}),
    passages: normalizePassages(row.passages),
    summary: row.summary ?? '',
    ...(row.summary_en ? { summaryEn: row.summary_en } : {}),
    points: normalizePoints(row.points),
    ...(Array.isArray(row.points_en) ? { pointsEn: normalizePoints(row.points_en) } : {}),
    mediaUrl: row.media_url ?? '',
    published: !!row.published,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  }
}

const SERMON_COLUMNS =
  'id, service, preached_on, title, title_en, preacher, preacher_en, passages, summary, summary_en, points, points_en, media_url, published, updated_at'

/**
 * 설교 목록을 최신 주일 순으로 읽는다. 미게시 설교가 섞여 오는지는 RLS가 결정하므로
 * (관리자만 보인다) 화면에서 관리자 모드가 아닐 때는 published로 한 번 더 거른다.
 */
export async function listSermons(): Promise<Sermon[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('sermons')
        .select(SERMON_COLUMNS)
        .order('preached_on', { ascending: false })
        .order('service', { ascending: true })

      if (error) throw error
      if (data) {
        const sermons = (data as SermonRow[]).map(rowToSermon)
        await db.transaction('rw', db.sermons, async () => {
          await db.sermons.clear()
          await db.sermons.bulkPut(sermons)
        })
        return sermons
      }
    } catch {
      // 오프라인이면 마지막으로 받아둔 목록으로 계속 묵상할 수 있게 한다
    }
  }

  const cached = await db.sermons.toArray()
  return cached.sort((a, b) => b.preachedOn.localeCompare(a.preachedOn) || a.service.localeCompare(b.service))
}

/** 아카이브 목록 한 줄 — 묵상 본문(data)은 빼고 설교 정보와 기록 지표만 담는다 */
export interface SermonNoteSummary {
  sermonId: string
  preachedOn: string
  service: SermonService
  title: string
  titleEn?: string
  passages: SermonPassage[]
  updatedAt: number
  revision: number
  highlightCount: number
  answeredPoints: number
  writtenFields: number
  /** 이 기기에만 있고 아직 서버에 못 올라간 기록 */
  pendingSync?: boolean
}

interface SermonNoteSummaryRow {
  sermon_id: string
  preached_on: string
  service: string
  title: string | null
  title_en: string | null
  passages: unknown
  note_updated_at: string
  revision: number
  highlight_count: number
  answered_points: number
  written_fields: number
}

/**
 * 내가 쓴 묵상 전체를 최신 주일 순으로 읽는다 — 아카이브 화면의 원천.
 * 목록에 data jsonb를 통째로 내리면 무거워서, 지표는 서버(list_my_sermon_notes)가 계산해 준다.
 */
export async function listMySermonNotes(): Promise<SermonNoteSummary[]> {
  if (!supabase) return []

  const { data, error } = await supabase.rpc('list_my_sermon_notes')
  if (error) throw error
  if (!Array.isArray(data)) return []

  return (data as SermonNoteSummaryRow[]).map((row) => ({
    sermonId: row.sermon_id,
    preachedOn: row.preached_on,
    service: row.service === 'afternoon' ? 'afternoon' : 'morning',
    title: row.title ?? '',
    ...(row.title_en ? { titleEn: row.title_en } : {}),
    passages: normalizePassages(row.passages),
    updatedAt: Date.parse(row.note_updated_at) || 0,
    revision: row.revision ?? 0,
    highlightCount: row.highlight_count ?? 0,
    answeredPoints: row.answered_points ?? 0,
    writtenFields: row.written_fields ?? 0,
  }))
}

/**
 * 이 기기(IndexedDB)에 남아 있는 내 묵상 요약.
 * 서버 저장이 실패했거나 오프라인이라 아직 못 올라간 기록도 보관함에서 보이게 하려는 것이다 —
 * 서버 목록만 믿으면 "분명히 썼는데 보관함에 없다"가 된다.
 * 아무것도 적히지 않은 빈 노트는 세지 않는다(화면을 열기만 해도 캐시가 생기기 때문).
 */
export async function listLocalSermonNoteSummaries(userId?: string): Promise<SermonNoteSummary[]> {
  const owner = userId ?? SERMON_LOCAL_USER
  const [notes, sermons] = await Promise.all([
    db.sermonNotes.where('key').startsWith(`${owner}:`).toArray(),
    db.sermons.toArray(),
  ])
  const sermonById = new Map(sermons.map((sermon) => [sermon.id, sermon]))

  return notes.flatMap((note) => {
    const sermon = sermonById.get(note.sermonId)
    if (!sermon) return []

    const highlightCount =
      note.highlightRanges.length +
      Object.values(note.highlightVersions ?? {}).reduce((sum, ranges) => sum + ranges.length, 0)
    const answeredPoints = note.pointAnswers.filter((answer) => !isFieldEmpty(answer)).length
    const writtenFields = [note.impression, note.application, note.freeNote].filter(
      (field) => field && !isFieldEmpty(field),
    ).length
    if (highlightCount === 0 && answeredPoints === 0 && writtenFields === 0) return []

    return [
      {
        sermonId: sermon.id,
        preachedOn: sermon.preachedOn,
        service: sermon.service,
        title: sermon.title,
        ...(sermon.titleEn ? { titleEn: sermon.titleEn } : {}),
        passages: sermon.passages,
        updatedAt: note.updatedAt,
        revision: note.revision,
        highlightCount,
        answeredPoints,
        writtenFields,
        pendingSync: note.dirty === true,
      },
    ]
  })
}

export function createSermonNote(sermonId: string, pointCount: number): SermonNote {
  return {
    sermonId,
    pointAnswers: Array.from({ length: pointCount }, () => emptyField()),
    impression: emptyField(),
    application: emptyField(),
    freeNote: emptyField(),
    highlightRanges: [],
    highlightVersions: {},
    revision: 0,
    updatedAt: Date.now(),
  }
}

const SERMON_NOTE_KNOWN_KEYS = new Set([
  'sermonId',
  'pointAnswers',
  'impression',
  'application',
  'freeNote',
  'highlightRanges',
  'highlightVersions',
  'revision',
  'updatedAt',
  'key',
  'userId',
  'preservedEntries',
  'dirty',
  'conflict',
  'baseRevision',
])

function preservedEntriesFrom(note: unknown): Map<string, unknown> {
  const preserved = new Map<string, unknown>()
  if (typeof note !== 'object' || note === null || Array.isArray(note)) return preserved

  const cache = note as Partial<SermonNoteCache>
  for (const [key, value] of cache[preservedSermonNoteData] ?? []) preserved.set(key, value)
  if (Array.isArray(cache.preservedEntries)) {
    for (const entry of cache.preservedEntries) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string') {
        preserved.set(entry[0], entry[1])
      }
    }
  }
  for (const [key, value] of Object.entries(note)) {
    if (!SERMON_NOTE_KNOWN_KEYS.has(key)) preserved.set(key, value)
  }
  return preserved
}

function attachPreservedData(note: SermonNote, preserved: Map<string, unknown>): SermonNote {
  if (preserved.size === 0) return note
  Object.defineProperty(note, preservedSermonNoteData, {
    configurable: false,
    enumerable: true,
    value: preserved,
    writable: false,
  })
  return note
}

/** 묵상 포인트가 줄어도 저장된 답은 보존하고, 늘어난 위치에만 빈 답을 만든다. */
export function normalizeSermonNoteData(
  sermonId: string,
  pointCount: number,
  note: unknown,
  remoteRevision?: number,
): SermonNote {
  const source =
    typeof note === 'object' && note !== null && !Array.isArray(note)
      ? (note as Partial<SermonNote>)
      : undefined
  const answers = Array.isArray(source?.pointAnswers) ? source.pointAnswers : []
  const normalizedCount = Math.max(Math.max(0, pointCount), answers.length)
  const revisionCandidate = remoteRevision ?? source?.revision ?? 0
  const normalized = {
    sermonId,
    pointAnswers: Array.from({ length: normalizedCount }, (_, index) => answers[index] ?? emptyField()),
    impression: source?.impression ?? emptyField(),
    application: source?.application ?? emptyField(),
    freeNote: source?.freeNote ?? emptyField(),
    highlightRanges: source?.highlightRanges ?? [],
    highlightVersions: source?.highlightVersions ?? {},
    revision:
      Number.isInteger(revisionCandidate) && revisionCandidate >= 0 ? revisionCandidate : 0,
    updatedAt: source?.updatedAt ?? Date.now(),
  }
  return attachPreservedData(normalized, preservedEntriesFrom(note))
}

/** helper symbol을 제외하고 legacy unknown key 위에 현재 known field를 덮어 원격 JSON을 만든다. */
export function serializeSermonNoteData(note: SermonNote): object {
  return {
    ...Object.fromEntries(note[preservedSermonNoteData] ?? []),
    sermonId: note.sermonId,
    pointAnswers: note.pointAnswers,
    impression: note.impression,
    application: note.application,
    freeNote: note.freeNote,
    highlightRanges: note.highlightRanges,
    highlightVersions: note.highlightVersions,
    updatedAt: note.updatedAt,
  }
}

function sermonNoteCache(
  note: SermonNote,
  owner: string,
  metadata: Pick<SermonNoteCache, 'dirty' | 'conflict' | 'baseRevision'> = {},
): SermonNoteCache {
  return {
    sermonId: note.sermonId,
    pointAnswers: note.pointAnswers,
    impression: note.impression,
    application: note.application,
    freeNote: note.freeNote,
    highlightRanges: note.highlightRanges,
    highlightVersions: note.highlightVersions,
    revision: note.revision,
    updatedAt: note.updatedAt,
    key: sermonNoteKey(owner, note.sermonId),
    userId: owner,
    preservedEntries: [...(note[preservedSermonNoteData] ?? [])],
    ...metadata,
  }
}

/** 비로그인 묵상의 로컬 저장 소유자 키 — auth.users의 uuid와 절대 겹치지 않는 값 */
export const SERMON_LOCAL_USER = 'local'

function sermonNoteKey(userId: string, sermonId: string): string {
  return `${userId}:${sermonId}`
}

function isStaleSermonNoteError(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes('SERMON_NOTE_STALE_REVISION')
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes('SERMON_NOTE_STALE_REVISION')
  )
}

function sermonRevisionFromResponse(data: unknown): number {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('revision' in data) ||
    typeof data.revision !== 'number' ||
    !Number.isInteger(data.revision) ||
    data.revision < 1
  ) {
    throw new Error('SERMON_NOTE_INVALID_RESPONSE')
  }
  return data.revision
}

async function verifySermonSessionOwner(userId: string): Promise<void> {
  // Defense-in-depth only. SQL validates p_owner_user_id against auth.uid() at the write boundary.
  await assertActiveSupabaseOwner(userId, 'SERMON_NOTE_OWNER_CHANGED')
}

/** 편집 직후 debounce와 무관하게 owner-scoped local cache에 먼저 기록한다. */
export async function stageSermonNoteLocally(
  note: SermonNote,
  userId?: string,
): Promise<SermonNote> {
  const owner = userId ?? SERMON_LOCAL_USER
  const key = sermonNoteKey(owner, note.sermonId)
  const next = normalizeSermonNoteData(note.sermonId, note.pointAnswers.length, note)
  await db.transaction('rw', db.sermonNotes, async () => {
    const current = await db.sermonNotes.get(key)
    if (current && current.updatedAt > next.updatedAt) return
    await db.sermonNotes.put(
      sermonNoteCache(next, owner, {
        dirty: userId ? true : false,
        conflict: current?.conflict ?? false,
        baseRevision: current?.baseRevision ?? next.revision,
      }),
    )
  })
  return next
}

async function completeSermonLocalSave(
  saved: SermonNote,
  owner: string,
  revision: number,
): Promise<SermonNote> {
  const key = sermonNoteKey(owner, saved.sermonId)
  let completed = { ...saved, revision }
  await db.transaction('rw', db.sermonNotes, async () => {
    const latestCache = await db.sermonNotes.get(key)
    const latest = latestCache
      ? normalizeSermonNoteData(saved.sermonId, saved.pointAnswers.length, latestCache, revision)
      : completed
    latest.revision = revision
    const hasNewerFields = latest.updatedAt > saved.updatedAt
    await db.sermonNotes.put(
      sermonNoteCache(latest, owner, {
        dirty: hasNewerFields,
        conflict: false,
        baseRevision: revision,
      }),
    )
    completed = latest
  })
  return completed
}

async function markSermonLocalSaveFailed(
  note: SermonNote,
  owner: string,
  conflict: boolean,
): Promise<void> {
  const key = sermonNoteKey(owner, note.sermonId)
  await db.transaction('rw', db.sermonNotes, async () => {
    const latestCache = await db.sermonNotes.get(key)
    const latest = latestCache
      ? normalizeSermonNoteData(note.sermonId, note.pointAnswers.length, latestCache)
      : note
    await db.sermonNotes.put(
      sermonNoteCache(latest, owner, {
        dirty: true,
        conflict: conflict || latestCache?.conflict === true,
        baseRevision: latestCache?.baseRevision ?? note.revision,
      }),
    )
  })
}

export async function getSermonNote(
  sermonId: string,
  pointCount: number,
  userId?: string,
): Promise<SermonNote> {
  // 로그인 없이도 묵상은 이 기기(IndexedDB)에 남는다 — 말씀 묵상 노트 앱과 같은 방식
  if (!userId) {
    const local = await db.sermonNotes.get(sermonNoteKey(SERMON_LOCAL_USER, sermonId))
    return normalizeSermonNoteData(sermonId, pointCount, local)
  }

  const key = sermonNoteKey(userId, sermonId)
  const local = await db.sermonNotes.get(key)

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('sermon_notes')
        .select('data, revision')
        .eq('user_id', userId)
        .eq('sermon_id', sermonId)
        .maybeSingle()

      if (error) throw error
      const remoteRevision =
        typeof data?.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0
          ? data.revision
          : 0
      const latestLocal = await db.sermonNotes.get(key)
      if (latestLocal?.dirty) {
        const localNote = normalizeSermonNoteData(sermonId, pointCount, latestLocal)
        await db.sermonNotes.put(
          sermonNoteCache(localNote, userId, {
            dirty: true,
            conflict: remoteRevision !== localNote.revision,
            baseRevision: latestLocal.baseRevision ?? localNote.revision,
          }),
        )
        return localNote
      }
      if (data?.data) {
        const note = normalizeSermonNoteData(sermonId, pointCount, data.data, remoteRevision)
        await db.sermonNotes.put(
          sermonNoteCache(note, userId, {
            dirty: false,
            conflict: false,
            baseRevision: remoteRevision,
          }),
        )
        return note
      }
    } catch (error) {
      // 오프라인/일시 오류 시 로컬 캐시로 폴백 — 묵상이 아예 안 열리는 것 방지
      console.warn('Sermon note remote load failed; using owner-scoped cache.', error)
    }
  }

  if (local) return normalizeSermonNoteData(sermonId, pointCount, local)

  const inherited = await claimAnonymousSermonNote(sermonId, pointCount, userId)
  return inherited ?? normalizeSermonNoteData(sermonId, pointCount, undefined, 0)
}

/** Each anonymous sermon note can be copied into at most one authenticated owner cache. */
export async function claimAnonymousSermonNote(
  sermonId: string,
  pointCount: number,
  userId: string,
): Promise<SermonNote | undefined> {
  let inherited: SermonNote | undefined
  await db.transaction('rw', db.sermonNotes, db.sermonNoteClaims, async () => {
    const claim = await db.sermonNoteClaims.get(sermonId)
    if (claim) return
    const ownerCache = await db.sermonNotes.get(sermonNoteKey(userId, sermonId))
    const anonymousCache = await db.sermonNotes.get(sermonNoteKey(SERMON_LOCAL_USER, sermonId))
    if (!shouldInheritAnonymousSermonNote(claim, ownerCache, anonymousCache)) return

    await db.sermonNoteClaims.put({ sermonId, ownerId: userId, claimedAt: Date.now() })
    const copy = normalizeSermonNoteData(sermonId, pointCount, anonymousCache, 0)
    await db.sermonNotes.put(
      sermonNoteCache(copy, userId, {
        dirty: true,
        conflict: false,
        baseRevision: 0,
      }),
    )
    inherited = copy
  })
  return inherited
}

export async function hasSermonNoteConflict(
  sermonId: string,
  userId?: string,
): Promise<boolean> {
  const owner = userId ?? SERMON_LOCAL_USER
  const cached = await db.sermonNotes.get(sermonNoteKey(owner, sermonId))
  return cached?.conflict === true
}

export async function putSermonNote(note: SermonNote, userId?: string): Promise<SermonNote> {
  const owner = userId ?? SERMON_LOCAL_USER
  const key = sermonNoteKey(owner, note.sermonId)
  const next = normalizeSermonNoteData(note.sermonId, note.pointAnswers.length, note)
  await stageSermonNoteLocally(next, userId)

  if (!supabase || !userId) {
    return next
  }
  const client = supabase

  await sermonSaveQueue.run(key, async () => {
    try {
      await verifySermonSessionOwner(userId)
      const { data, error } = await client.rpc('put_sermon_note', {
        p_owner_user_id: userId,
        p_sermon_id: next.sermonId,
        p_expected_revision: next.revision,
        p_data: serializeSermonNoteData(next),
      })
      if (error) throw error
      const revision = sermonRevisionFromResponse(data)
      next.revision = revision
      note.revision = revision
      await completeSermonLocalSave(next, owner, revision)
    } catch (error) {
      await markSermonLocalSaveFailed(next, owner, isStaleSermonNoteError(error))
      throw error
    }
  })
  return next
}

/** 충돌 배너에서 사용자가 명시적으로 local 내용을 선택했을 때만 원격 revision 위에 저장한다. */
export async function resolveSermonConflictKeepLocal(
  note: SermonNote,
  userId: string,
): Promise<SermonNote> {
  if (!supabase || !userId) throw new Error('SERMON_NOTE_OWNER_CHANGED')
  const client = supabase
  const key = sermonNoteKey(userId, note.sermonId)
  const next = await stageSermonNoteLocally(note, userId)
  let saved = next

  await sermonSaveQueue.run(key, async () => {
    try {
      await verifySermonSessionOwner(userId)
      const { data: remote, error: revisionError } = await client
        .from('sermon_notes')
        .select('revision')
        .eq('user_id', userId)
        .eq('sermon_id', next.sermonId)
        .maybeSingle()
      if (revisionError) throw revisionError
      const expectedRevision =
        typeof remote?.revision === 'number' && Number.isInteger(remote.revision)
          ? remote.revision
          : 0

      await verifySermonSessionOwner(userId)
      const { data, error } = await client.rpc('put_sermon_note', {
        p_owner_user_id: userId,
        p_sermon_id: next.sermonId,
        p_expected_revision: expectedRevision,
        p_data: serializeSermonNoteData(next),
      })
      if (error) throw error
      const revision = sermonRevisionFromResponse(data)
      next.revision = revision
      note.revision = revision
      saved = await completeSermonLocalSave(next, userId, revision)
    } catch (error) {
      await markSermonLocalSaveFailed(next, userId, true)
      throw error
    }
  })
  return saved
}

/** 충돌 배너에서 원격을 선택했을 때, 원격 조회 성공 뒤에만 dirty cache를 교체한다. */
export async function resolveSermonConflictUseRemote(
  sermonId: string,
  pointCount: number,
  userId: string,
): Promise<SermonNote> {
  if (!supabase || !userId) throw new Error('SERMON_NOTE_OWNER_CHANGED')
  const key = sermonNoteKey(userId, sermonId)
  const localBefore = await db.sermonNotes.get(key)
  await verifySermonSessionOwner(userId)
  const { data, error } = await supabase
    .from('sermon_notes')
    .select('data, revision')
    .eq('user_id', userId)
    .eq('sermon_id', sermonId)
    .maybeSingle()
  if (error) throw error
  const revision =
    typeof data?.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0
      ? data.revision
      : 0
  const remote = normalizeSermonNoteData(sermonId, pointCount, data?.data, revision)
  await db.transaction('rw', db.sermonNotes, async () => {
    const latest = await db.sermonNotes.get(key)
    if (latest && localBefore && latest.updatedAt > localBefore.updatedAt) {
      throw new Error('SERMON_NOTE_NEWER_LOCAL_EDIT')
    }
    await db.sermonNotes.put(
      sermonNoteCache(remote, userId, {
        dirty: false,
        conflict: false,
        baseRevision: revision,
      }),
    )
  })
  return remote
}

/** 설교 등록·수정. 같은 주일·예배가 이미 있으면 덮어쓴다(unique 제약과 같은 기준). */
export async function upsertSermon(sermon: Sermon): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase.from('sermons').upsert(
    {
      id: sermon.id,
      service: sermon.service,
      preached_on: sermon.preachedOn,
      title: sermon.title,
      preacher: sermon.preacher || null,
      passages: sermon.passages,
      summary: sermon.summary || null,
      points: sermon.points,
      media_url: sermon.mediaUrl || null,
      published: sermon.published,
      ...(sermon.titleEn !== undefined ? { title_en: sermon.titleEn || null } : {}),
      ...(sermon.preacherEn !== undefined ? { preacher_en: sermon.preacherEn || null } : {}),
      ...(sermon.summaryEn !== undefined ? { summary_en: sermon.summaryEn || null } : {}),
      ...(sermon.pointsEn !== undefined ? { points_en: sermon.pointsEn } : {}),
    },
    { onConflict: 'preached_on,service', defaultToNull: false },
  )
  if (error) throw error
}

/**
 * 이 설교에 달린 교인 묵상 수. 설교를 지우면 묵상도 함께 사라지므로(FK cascade)
 * 관리자가 삭제를 결정하기 전에 영향 범위를 보여주기 위한 값이다.
 * sermon_notes는 RLS로 본인 것만 보이니 전체 개수는 관리자 전용 RPC로만 셀 수 있다.
 */
export async function countSermonNotes(sermonId: string): Promise<number> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('count_sermon_notes', { p_sermon_id: sermonId })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

export async function deleteSermon(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase.from('sermons').delete().eq('id', id)
  if (error) throw error
  await db.sermons.delete(id)
}
