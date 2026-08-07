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

  const { data, error } = await supabase
    .from('bible_chapters')
    .select('updated_at')
    .eq('book_order', bookOrder)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return typeof data?.updated_at === 'string' ? data.updated_at : null
}

export async function loadRemoteBook(file: string, fallback: BookDoc): Promise<RemoteBook | null> {
  if (!supabase) return null

  const order = fallback.order || orderFromFile(file)
  if (!order) return null

  const initial = await supabase
    .from('bible_chapters')
    .select('book_order, book, abbr, file, chapter, text, is_finalized, updated_at')
    .eq('book_order', order)
    .order('chapter', { ascending: true })
  let data = initial.data as BibleChapterRow[] | null
  let error = initial.error
  let supportsFinalize = true

  if (error && /is_finalized|schema cache/i.test(error.message)) {
    const fallback = await supabase
      .from('bible_chapters')
      .select('book_order, book, abbr, file, chapter, text, updated_at')
      .eq('book_order', order)
      .order('chapter', { ascending: true })
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
