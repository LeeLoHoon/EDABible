import { supabase } from './supabase'
import type { BookDoc } from './bible'

interface BibleChapterRow {
  book_order: number
  book: string
  abbr: string
  file: string
  chapter: number
  text: string
  is_finalized?: boolean
  updated_at?: string
}

function orderFromFile(file: string): number | null {
  const match = file.match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

// Supabase DB가 무응답(커넥션 풀 고갈 등)일 때 요청이 무한정 매달리면 loadBook이
// 영영 resolve되지 않아 장/편 셀렉트가 disabled로 고착된다. 제한 시간 안에 답이
// 없으면 끊고 throw — loadBook의 catch가 로컬 캐시/정적 본문으로 넘어간다.
const STAMP_TIMEOUT_MS = 4_000
const BOOK_TIMEOUT_MS = 10_000

function timeoutSignal(ms: number): AbortSignal | null {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : null
}

export interface RemoteBook {
  doc: BookDoc
  /** 이 본문의 최신 updated_at — 다음 로드에서 재다운로드 여부를 가리는 기준 */
  stamp: string | null
}

/**
 * 그 책에서 가장 최근에 바뀐 시각만 받아온다(수십 바이트). 관리자가 본문을 고치지 않는 한
 * 이 값이 그대로이므로, 캐시가 최신인지 확인하려고 책 한 권(수백 KB)을 받을 필요가 없다.
 */
export async function loadRemoteBookStamp(file: string, order?: number): Promise<string | null> {
  if (!supabase) return null
  const bookOrder = order || orderFromFile(file)
  if (!bookOrder) return null

  let query = supabase
    .from('bible_chapters')
    .select('updated_at')
    .eq('book_order', bookOrder)
    .order('updated_at', { ascending: false })
    .limit(1)
  const signal = timeoutSignal(STAMP_TIMEOUT_MS)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return typeof data?.updated_at === 'string' ? data.updated_at : null
}

export async function loadRemoteBook(file: string, fallback: BookDoc): Promise<RemoteBook | null> {
  if (!supabase) return null

  const order = fallback.order || orderFromFile(file)
  if (!order) return null

  let initialQuery = supabase
    .from('bible_chapters')
    .select('book_order, book, abbr, file, chapter, text, is_finalized, updated_at')
    .eq('book_order', order)
    .order('chapter', { ascending: true })
  const initialSignal = timeoutSignal(BOOK_TIMEOUT_MS)
  if (initialSignal) initialQuery = initialQuery.abortSignal(initialSignal)
  const initial = await initialQuery
  let data = initial.data as BibleChapterRow[] | null
  let error = initial.error
  let supportsFinalize = true

  if (error && /is_finalized|schema cache/i.test(error.message)) {
    let fallbackQuery = supabase
      .from('bible_chapters')
      .select('book_order, book, abbr, file, chapter, text, updated_at')
      .eq('book_order', order)
      .order('chapter', { ascending: true })
    const fallbackSignal = timeoutSignal(BOOK_TIMEOUT_MS)
    if (fallbackSignal) fallbackQuery = fallbackQuery.abortSignal(fallbackSignal)
    const fallback = await fallbackQuery
    data = fallback.data as BibleChapterRow[] | null
    error = fallback.error
    supportsFinalize = false
  }

  if (error) throw error
  if (!data || data.length === 0) return null

  const rows = data as BibleChapterRow[]
  const remoteByChapter = new Map(rows.map((row) => [row.chapter, row.text]))
  const finalizedByChapter = new Map(rows.map((row) => [row.chapter, !!row.is_finalized]))
  const chapters = fallback.chapters.map((chapter) => ({
    ...chapter,
    text: remoteByChapter.get(chapter.chapter) ?? chapter.text,
    isFinalized: finalizedByChapter.get(chapter.chapter) ?? chapter.isFinalized,
  }))

  for (const row of rows) {
    if (!chapters.some((chapter) => chapter.chapter === row.chapter)) {
      chapters.push({ chapter: row.chapter, text: row.text, isFinalized: !!row.is_finalized })
    }
  }

  chapters.sort((a, b) => a.chapter - b.chapter)

  let stamp: string | null = null
  for (const row of rows) {
    if (typeof row.updated_at === 'string' && (!stamp || row.updated_at > stamp)) {
      stamp = row.updated_at
    }
  }

  return {
    doc: {
      order: fallback.order || rows[0].book_order,
      book: fallback.book || rows[0].book,
      abbr: fallback.abbr || rows[0].abbr,
      chapters,
      supportsFinalize,
    },
    stamp,
  }
}

export async function finalizeRemoteChapter(params: {
  file: string
  doc: BookDoc
  chapter: number
}): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('bible_chapters')
    .update({
      is_finalized: true,
      finalized_at: new Date().toISOString(),
    })
    .eq('book_order', params.doc.order)
    .eq('chapter', params.chapter)
    .eq('file', params.file)

  if (error) throw error
}

/**
 * 완료 표시를 되돌린다. RLS가 완료된 행의 UPDATE를 막으므로 직접 update 하지 못하고,
 * 플래그만 뒤집는 security definer 함수(unfinalize_bible_chapter)를 통해 푼다.
 */
export async function unfinalizeRemoteChapter(params: {
  doc: BookDoc
  chapter: number
}): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.rpc('unfinalize_bible_chapter', {
    p_book_order: params.doc.order,
    p_chapter: params.chapter,
  })

  if (error) throw error
}

export async function saveRemoteChapterText(params: {
  file: string
  doc: BookDoc
  chapter: number
  previousText: string
  nextText: string
  build: string
}): Promise<void> {
  if (!supabase) return

  const { error: upsertError } = await supabase.from('bible_chapters').upsert(
    {
      book_order: params.doc.order,
      book: params.doc.book,
      abbr: params.doc.abbr,
      file: params.file,
      chapter: params.chapter,
      text: params.nextText,
      source_build: params.build,
    },
    { onConflict: 'book_order,chapter' },
  )

  if (upsertError) throw upsertError

  const { error: editError } = await supabase.from('bible_chapter_edits').insert({
    book_order: params.doc.order,
    book: params.doc.book,
    chapter: params.chapter,
    previous_text: params.previousText,
    next_text: params.nextText,
    editor_label: 'public-admin',
    status: 'approved',
  })

  if (editError) throw editError
}
