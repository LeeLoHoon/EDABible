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
}

function orderFromFile(file: string): number | null {
  const match = file.match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

export async function loadRemoteBook(file: string, fallback: BookDoc): Promise<BookDoc | null> {
  if (!supabase) return null

  const order = fallback.order || orderFromFile(file)
  if (!order) return null

  const initial = await supabase
    .from('bible_chapters')
    .select('book_order, book, abbr, file, chapter, text, is_finalized')
    .eq('book_order', order)
    .order('chapter', { ascending: true })
  let data = initial.data as BibleChapterRow[] | null
  let error = initial.error
  let supportsFinalize = true

  if (error && /is_finalized|schema cache/i.test(error.message)) {
    const fallback = await supabase
      .from('bible_chapters')
      .select('book_order, book, abbr, file, chapter, text')
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

  return {
    order: fallback.order || rows[0].book_order,
    book: fallback.book || rows[0].book,
    abbr: fallback.abbr || rows[0].abbr,
    chapters,
    supportsFinalize,
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
