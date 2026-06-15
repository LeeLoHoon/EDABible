import { mkdir, readFile, writeFile } from 'node:fs/promises'

const BOOKS_PATH = 'data/bible-books.json'
const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const OUT_DIR = 'public/bible'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readJsonl(path) {
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const books = await readJson(BOOKS_PATH)
const chapters = await readJsonl(CHAPTERS_PATH)
const byOrder = new Map()

for (const row of chapters) {
  if (!byOrder.has(row.book_order)) byOrder.set(row.book_order, [])
  byOrder.get(row.book_order).push(row)
}

await mkdir(OUT_DIR, { recursive: true })

const index = []
const issues = []

for (const book of books) {
  const rows = (byOrder.get(book.order) ?? []).sort((a, b) => a.chapter - b.chapter)
  const expected = new Set(Array.from({ length: book.standardChapters }, (_, index) => index + 1))
  const actual = new Set(rows.map((row) => row.chapter))
  const missing = [...expected].filter((chapter) => !actual.has(chapter))
  const extra = [...actual].filter((chapter) => !expected.has(chapter))

  if (missing.length || extra.length) {
    issues.push({ book: book.book, missing, extra })
  }

  const doc = {
    order: book.order,
    book: book.book,
    abbr: book.abbr,
    chapters: rows.map((row) => ({
      chapter: row.chapter,
      text: row.text,
    })),
  }

  await writeFile(`${OUT_DIR}/${book.file}`, JSON.stringify(doc, null, 1) + '\n')

  index.push({
    order: book.order,
    book: book.book,
    abbr: book.abbr,
    file: book.file,
    chapters: rows.length,
    standardChapters: book.standardChapters,
  })
}

if (issues.length > 0) {
  console.error(JSON.stringify({ issues }, null, 2))
  process.exit(1)
}

await writeFile(`${OUT_DIR}/index.json`, JSON.stringify(index, null, 1) + '\n')
console.log(JSON.stringify({ books: index.length, chapters: chapters.length }, null, 2))
