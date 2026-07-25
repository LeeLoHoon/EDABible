import Dexie, { type Table } from 'dexie'
import { emptyField, type Entry, type Field } from './types'
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

/** 로컬(IndexedDB) 저장소 — 묵상 노트 저장 및 바인더 오프라인 캐시. */
class EdaBibleDB extends Dexie {
  entries!: Table<Entry, string>
  bibleIndex!: Table<BibleIndexCache, string>
  bibleBooks!: Table<BibleBookCache, string>
  binderWorks!: Table<BinderWork, string>

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

/** 계정에서 가장 최근에 사용한 권의 bookId — 기록이 없으면 undefined */
export async function getLastBinderBookId(userId?: string): Promise<string | undefined> {
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from('binder_works')
        .select('book_id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!error && data?.book_id) return data.book_id as string
    } catch {
      // 네트워크 실패 시 로컬 캐시로 폴백
    }
  }

  const latest = await db.binderWorks.orderBy('updatedAt').reverse().first()
  return latest?.bookId
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
