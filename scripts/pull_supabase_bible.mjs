import { readFile, stat, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

async function loadLocalEnv(path) {
  try {
    await stat(path)
  } catch {
    return
  }

  const text = await readFile(path, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 1) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    process.env[key] ??= value
  }
}

await loadLocalEnv('.env.local')

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function fetchAllChapters() {
  const rows = []

  for (let from = 0; ; from += 1000) {
    const to = from + 999
    const { data, error } = await supabase
      .from('bible_chapters')
      .select('book_order, book, abbr, file, chapter, text')
      .order('book_order', { ascending: true })
      .order('chapter', { ascending: true })
      .range(from, to)

    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  return rows
}

const books = await readJson('data/bible-books.json')
const rows = await fetchAllChapters()
const byOrder = new Map()

for (const row of rows) {
  if (!byOrder.has(row.book_order)) byOrder.set(row.book_order, [])
  byOrder.get(row.book_order).push(row)
}

const issues = []
const normalizedRows = []

for (const book of books) {
  const chapters = (byOrder.get(book.order) ?? []).sort((a, b) => a.chapter - b.chapter)
  const expected = new Set(Array.from({ length: book.standardChapters }, (_, index) => index + 1))
  const actual = new Set(chapters.map((row) => row.chapter))
  const missing = [...expected].filter((chapter) => !actual.has(chapter))
  const extra = [...actual].filter((chapter) => !expected.has(chapter))

  if (missing.length || extra.length) {
    issues.push({ book: book.book, missing, extra })
  }

  for (const row of chapters) {
    if (!expected.has(row.chapter)) continue
    normalizedRows.push({
      book_order: book.order,
      book: book.book,
      abbr: book.abbr,
      file: book.file,
      chapter: row.chapter,
      text: row.text,
    })
  }
}

if (issues.length > 0 || normalizedRows.length !== 1189) {
  console.error(JSON.stringify({ rows: normalizedRows.length, issues }, null, 2))
  process.exit(1)
}

await writeFile(
  'data/bible-chapters.jsonl',
  normalizedRows.map((row) => JSON.stringify(row)).join('\n') + '\n',
)

console.log(JSON.stringify({ chapters: normalizedRows.length }, null, 2))
