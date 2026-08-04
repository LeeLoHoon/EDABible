import Dexie, { type Table } from 'dexie'
import { emptyField, type Entry, type Field, type VerseHighlight } from './types'
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

export { normalizeBinderWork } from './binderCache'

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
  entries!: Table<Entry, string>
  bibleIndex!: Table<BibleIndexCache, string>
  bibleBooks!: Table<BibleBookCache, string>
  binderWorks!: Table<BinderWork, string>
  binderWorksByOwner!: Table<BinderWorkCacheRecord, [string, string]>
  binderClaims!: Table<BinderClaim, string>
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
  }
}

export const db = new EdaBibleDB()

const binderSaveQueue = new SerializedSaveQueue()
const sermonSaveQueue = new SerializedSaveQueue()

export const BINDER_LOCAL_OWNER = 'local'
const BINDER_LEGACY_CLAIM_ID = 'legacy-binder-works:v1'

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

export async function getEntry(id: string): Promise<Entry | undefined> {
  return db.entries.get(id)
}

export async function putEntry(entry: Entry): Promise<void> {
  await db.entries.put(entry)
}

export async function commitEntrySnapshot(snapshot: Entry): Promise<EntryCommitResult> {
  return db.transaction('rw', db.entries, () =>
    commitEntryInTransaction(
      {
        get: (id) => db.entries.get(id),
        put: async (entry) => {
          await db.entries.put(entry)
        },
      },
      snapshot,
    ),
  )
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id)
}

/** 모든 묵상 삭제 */
export async function clearAllEntries(): Promise<void> {
  await db.entries.clear()
}

/** 최신순 전체 목록 */
export async function listEntries(): Promise<Entry[]> {
  return db.entries.orderBy('updatedAt').reverse().toArray()
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
