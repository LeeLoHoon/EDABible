import Dexie, { type Table } from 'dexie'
import { emptyField, type Entry, type Field, type VerseHighlight } from './types'
import { supabase } from './supabase'

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
  preacher: string
  passages: SermonPassage[]
  summary: string
  points: string[]
  mediaUrl: string
  published: boolean
  updatedAt: number
}

/** 교인의 묵상 — sermon_notes.data에 통째로 들어가는 jsonb.
    binder_works와 같은 방식이라 스키마 변경 없이 필드를 늘릴 수 있다. */
export interface SermonNote {
  sermonId: string
  pointAnswers: Field[]
  freeNote: Field
  /** 메시지성경(기본 역본) 형광펜 — 기존 데이터와의 호환을 위해 이름을 유지한다 */
  highlightRanges: VerseHighlight[]
  /** 다른 역본(gae/nkt)의 형광펜 — 역본마다 글자 위치가 달라 분리 저장한다 */
  highlightVersions: Record<string, VerseHighlight[]>
  updatedAt: number
}

/** 로컬 캐시 레코드 — 한 기기를 여러 계정이 함께 쓸 때 묵상이 섞이지 않도록 사용자별로 키를 나눈다 */
interface SermonNoteCache extends SermonNote {
  key: string
  userId: string
}

/** 로컬(IndexedDB) 저장소 — 묵상 노트 저장 및 바인더 오프라인 캐시. */
class EdaBibleDB extends Dexie {
  entries!: Table<Entry, string>
  bibleIndex!: Table<BibleIndexCache, string>
  bibleBooks!: Table<BibleBookCache, string>
  binderWorks!: Table<BinderWork, string>
  binderHiddenPages!: Table<BinderHiddenPages, string>
  recordings!: Table<Recording, string>
  sermons!: Table<Sermon, string>
  sermonNotes!: Table<SermonNoteCache, string>

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
  }
}

export const db = new EdaBibleDB()

export async function getEntry(id: string): Promise<Entry | undefined> {
  return db.entries.get(id)
}

export async function putEntry(entry: Entry): Promise<void> {
  await db.entries.put(entry)
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

function normalizeBinderWork(bookId: string, work: Partial<BinderWork> | null | undefined): BinderWork {
  return {
    ...createBinderWork(bookId),
    ...work,
    pageInputs: work?.pageInputs ?? {},
    pageTextBoxes: work?.pageTextBoxes ?? {},
    bookmarks: work?.bookmarks ?? [],
    checkpointPages: work?.checkpointPages ?? {},
  }
}

export async function getBinderWork(bookId: string, userId?: string): Promise<BinderWork> {
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
        const work = normalizeBinderWork(bookId, data.data as Partial<BinderWork>)
        await db.binderWorks.put(work)
        return work
      }
    } catch {
      // 오프라인/일시 오류 시 로컬 캐시로 폴백 — 바인더가 아예 안 열리는 것 방지
    }
  }

  return normalizeBinderWork(bookId, await db.binderWorks.get(bookId))
}

/** 계정에서 가장 최근에 사용한 권의 bookId — 선택 필터를 만족하는 기록이 없으면 undefined */
export async function getLastBinderBookId(
  userId?: string,
  isKnown?: (id: string) => boolean,
): Promise<string | undefined> {
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
    } catch {
      // 네트워크 실패 시 로컬 캐시로 폴백
    }
  }

  const localWorks = await db.binderWorks.orderBy('updatedAt').reverse().toArray()
  return localWorks.find((work) => !isKnown || isKnown(work.bookId))?.bookId
}

export async function putBinderWork(work: BinderWork, userId?: string): Promise<void> {
  const next = { ...work, updatedAt: Date.now() }
  await db.binderWorks.put(next)

  if (!supabase || !userId) return

  const { error } = await supabase.from('binder_works').upsert({
    user_id: userId,
    book_id: next.bookId,
    data: next,
    updated_at: new Date(next.updatedAt).toISOString(),
  })
  if (error) throw error
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
  preacher: string | null
  passages: unknown
  summary: string | null
  points: unknown
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
    preacher: row.preacher ?? '',
    passages: normalizePassages(row.passages),
    summary: row.summary ?? '',
    points: normalizePoints(row.points),
    mediaUrl: row.media_url ?? '',
    published: !!row.published,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  }
}

const SERMON_COLUMNS = 'id, service, preached_on, title, preacher, passages, summary, points, media_url, published, updated_at'

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

export function createSermonNote(sermonId: string, pointCount: number): SermonNote {
  return {
    sermonId,
    pointAnswers: Array.from({ length: pointCount }, () => emptyField()),
    freeNote: emptyField(),
    highlightRanges: [],
    highlightVersions: {},
    updatedAt: Date.now(),
  }
}

/** 묵상 포인트가 나중에 늘거나 줄어도 이미 쓴 답이 밀리지 않도록 길이만 맞춘다 */
function normalizeSermonNote(
  sermonId: string,
  pointCount: number,
  note: Partial<SermonNote> | null | undefined,
): SermonNote {
  const answers = Array.isArray(note?.pointAnswers) ? note.pointAnswers : []
  return {
    sermonId,
    pointAnswers: Array.from({ length: pointCount }, (_, index) => answers[index] ?? emptyField()),
    freeNote: note?.freeNote ?? emptyField(),
    highlightRanges: note?.highlightRanges ?? [],
    highlightVersions: note?.highlightVersions ?? {},
    updatedAt: note?.updatedAt ?? Date.now(),
  }
}

/** 비로그인 묵상의 로컬 저장 소유자 키 — auth.users의 uuid와 절대 겹치지 않는 값 */
export const SERMON_LOCAL_USER = 'local'

function sermonNoteKey(userId: string, sermonId: string): string {
  return `${userId}:${sermonId}`
}

export async function getSermonNote(
  sermonId: string,
  pointCount: number,
  userId?: string,
): Promise<SermonNote> {
  // 로그인 없이도 묵상은 이 기기(IndexedDB)에 남는다 — 말씀 묵상 노트 앱과 같은 방식
  if (!userId) {
    const local = await db.sermonNotes.get(sermonNoteKey(SERMON_LOCAL_USER, sermonId))
    return normalizeSermonNote(sermonId, pointCount, local)
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('sermon_notes')
        .select('data')
        .eq('user_id', userId)
        .eq('sermon_id', sermonId)
        .maybeSingle()

      if (error) throw error
      if (data?.data) {
        const note = normalizeSermonNote(sermonId, pointCount, data.data as Partial<SermonNote>)
        await db.sermonNotes.put({ ...note, key: sermonNoteKey(userId, sermonId), userId })
        return note
      }
    } catch {
      // 오프라인/일시 오류 시 로컬 캐시로 폴백 — 묵상이 아예 안 열리는 것 방지
    }
  }

  const cached = await db.sermonNotes.get(sermonNoteKey(userId, sermonId))
  if (cached) return normalizeSermonNote(sermonId, pointCount, cached)

  // 계정에 아무 기록이 없으면 로그인 전에 이 기기에서 쓴 묵상을 이어받는다 —
  // 바인더의 로컬→계정 업로드와 같은 규칙. 다음 저장 때 계정으로 올라간다.
  const anonymous = await db.sermonNotes.get(sermonNoteKey(SERMON_LOCAL_USER, sermonId))
  return normalizeSermonNote(sermonId, pointCount, anonymous)
}

export async function putSermonNote(note: SermonNote, userId?: string): Promise<void> {
  const next = { ...note, updatedAt: Date.now() }
  const owner = userId ?? SERMON_LOCAL_USER
  await db.sermonNotes.put({ ...next, key: sermonNoteKey(owner, next.sermonId), userId: owner })

  if (!supabase || !userId) return

  const { error } = await supabase.from('sermon_notes').upsert({
    user_id: userId,
    sermon_id: next.sermonId,
    data: next,
    updated_at: new Date(next.updatedAt).toISOString(),
  })
  if (error) throw error
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
    },
    { onConflict: 'preached_on,service' },
  )
  if (error) throw error
}

export async function deleteSermon(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase.from('sermons').delete().eq('id', id)
  if (error) throw error
  await db.sermons.delete(id)
}
