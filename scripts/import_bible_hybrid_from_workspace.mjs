import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const SOURCE_PATH = process.argv[2] ?? '../bible/work/final/hybrid/bible.jsonl'
const USE_GIT_HEAD_BASELINE = process.argv.includes('--baseline-git-head')
const BOOKS_PATH = 'data/bible-books.json'
const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const REPORT_PATH = '.tmp/bible-import-compare.json'

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

function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/^[\])]\s*/, '')
    .trim()
}

function isDisplayHeading(heading) {
  if (!heading) return false
  return !/유튜브|youtube|본문|OCR|ASR|설명란/i.test(heading)
}

function verseLabel(record) {
  const start = Number(record.verse_start ?? 0)
  const end = Number(record.verse_end ?? start)
  if (!start) return null
  return end && end !== start ? `${start}-${end}` : `${start}`
}

function cleanRecordText(text) {
  return text
    .trim()
    .replace(/^[\])]\s*/, '')
    .trim()
}

function chapterText(records, { structured = false } = {}) {
  if (!structured) {
    return normalizeText(records.map((record) => cleanRecordText(record.text ?? '')).filter(Boolean).join('\n\n'))
  }

  const lines = []
  let previousHeading = null
  for (const record of records) {
    let text = cleanRecordText(record.text ?? '')
    if (!text) continue

    const inlineHeading = text.match(/^\((?!\d{1,3}(?:[-~]\d{1,3})?\))([^\n)]{2,80})\)\s*\n+/)
    const heading = isDisplayHeading(record.heading)
      ? record.heading.trim()
      : inlineHeading
        ? inlineHeading[1].trim()
        : null
    if (inlineHeading && heading === inlineHeading[1].trim()) {
      text = text.slice(inlineHeading[0].length).trim()
    }

    if (heading && heading !== previousHeading) {
      if (lines.length > 0) lines.push('')
      lines.push(`[[${heading}]]`)
      previousHeading = heading
    }

    const label = verseLabel(record)
    lines.push(label ? `(${label}) ${text}` : text)
  }

  return normalizeText(lines.join('\n'))
}

function plainChapterText(records) {
  return normalizeText(records.map((record) => cleanRecordText(record.text ?? '')).filter(Boolean).join('\n\n'))
}

function scoreText(text) {
  const firstLine = text.trim().split('\n', 1)[0] ?? ''
  const verseLine = /^\s*\(?\d{1,3}(?:-\d{1,3})?\)?(?:\s|$)/
  const inlineVerse = /(?:^|\n|\s)\(?\d{1,3}(?:-\d{1,3})?\)?\s+[가-힣"“']/
  const residue =
    /[ㄱ-ㅎㅏ-ㅣ]|。|하나넘|학나님|허나님|차나님|연지베게|엉검퀴|숫아|일컴|울부지|뽑어|디스리|떨감|무었|계신거야|부혔다오|뼈프린다|발을팡|아리따운 여인 아|연희는|제품에 도시|구매 도시/g
  let score = 0
  score += (text.match(residue)?.length ?? 0) * 40
  score += (text.match(/[A-Za-z]{2,}/g)?.length ?? 0) * 6
  score += (text.match(inlineVerse)?.length ?? 0) * 10
  if (verseLine.test(firstLine)) score += 1000
  if (text.length < 250) score += 600
  if (text.length < 600) score += 200
  return score
}

function countMatches(texts, pattern) {
  let count = 0
  for (const text of texts) {
    count += text.match(pattern)?.length ?? 0
  }
  return count
}

const books = await readJson(BOOKS_PATH)
let oldRows
if (USE_GIT_HEAD_BASELINE) {
  const text = execFileSync('git', ['show', `HEAD:${CHAPTERS_PATH}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  oldRows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
} else {
  oldRows = await readJsonl(CHAPTERS_PATH)
}
const sourceRows = await readJsonl(SOURCE_PATH)

const oldByKey = new Map(oldRows.map((row) => [`${row.book_order}:${row.chapter}`, row]))
const sourceByKey = new Map()

for (const row of sourceRows) {
  const key = `${row.book_index}:${row.chapter}`
  if (!sourceByKey.has(key)) sourceByKey.set(key, [])
  sourceByKey.get(key).push(row)
}

for (const records of sourceByKey.values()) {
  records.sort((a, b) => {
    const verseA = Number(a.verse_start ?? 0)
    const verseB = Number(b.verse_start ?? 0)
    return verseA - verseB
  })
}

const newRows = []
const issues = []
const changed = []

for (const book of books) {
  for (let chapter = 1; chapter <= book.standardChapters; chapter += 1) {
    const key = `${book.order}:${chapter}`
    const records = sourceByKey.get(key)
    if (!records?.length) {
      issues.push({ type: 'missing-source-chapter', book: book.book, chapter })
      continue
    }

    const oldRow = oldByKey.get(key)
    const sourcePlainText = plainChapterText(records)
    if (!sourcePlainText) {
      issues.push({ type: 'empty-source-chapter', book: book.book, chapter })
      continue
    }
    const sourceText = chapterText(records, { structured: true })

    const oldText = oldRow?.text ? normalizeText(oldRow.text) : ''
    const sourceScore = scoreText(sourcePlainText)
    const oldScore = oldText ? scoreText(oldText) : Number.POSITIVE_INFINITY
    const useOld = oldText && oldScore + 25 < sourceScore
    const text = useOld ? oldText : sourceText

    const row = {
      book_order: book.order,
      book: book.book,
      abbr: book.abbr,
      file: book.file,
      chapter,
      text,
    }

    if (oldRow?.is_finalized === true) {
      row.is_finalized = true
    }

    if (!oldRow || oldRow.text !== text || oldRow.is_finalized !== row.is_finalized) {
      changed.push({
        book: book.book,
        chapter,
        oldLength: oldRow?.text?.length ?? 0,
        newLength: text.length,
        oldScore,
        sourceScore,
        selected: useOld ? 'existing' : 'hybrid',
        sourceQuality: records.every((record) => record.quality === 'verified') ? 'verified' : 'fallback',
        sourceNames: [...new Set(records.map((record) => record.source_name ?? record.ocr_source).filter(Boolean))],
      })
    }

    newRows.push(row)
  }
}

if (issues.length > 0) {
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, JSON.stringify({ issues }, null, 2) + '\n')
  throw new Error(`Import failed with ${issues.length} issue(s). See ${REPORT_PATH}`)
}

const oldTexts = oldRows.map((row) => row.text ?? '')
const newTexts = newRows.map((row) => row.text ?? '')
const ocrResiduePattern =
  /[ㄱ-ㅎㅏ-ㅣ]|。|하나넘|학나님|허나님|차나님|연지베게|엉검퀴|숫아|일컴|울부지|뽑어|디스리|떨감|무었|안된다|계신거야/g

const report = {
  sourcePath: SOURCE_PATH,
  chapters: newRows.length,
  changedChapters: changed.length,
  verifiedSourceChapters: changed.filter((row) => row.sourceQuality === 'verified').length,
  fallbackSourceChapters: changed.filter((row) => row.sourceQuality !== 'verified').length,
  oldChars: oldTexts.reduce((sum, text) => sum + text.length, 0),
  newChars: newTexts.reduce((sum, text) => sum + text.length, 0),
  oldOcrResidueHits: countMatches(oldTexts, ocrResiduePattern),
  newOcrResidueHits: countMatches(newTexts, ocrResiduePattern),
  changed,
}

await writeFile(CHAPTERS_PATH, newRows.map((row) => JSON.stringify(row)).join('\n') + '\n')
await mkdir(dirname(REPORT_PATH), { recursive: true })
await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')

console.log(
  JSON.stringify(
    {
      chapters: report.chapters,
      changedChapters: report.changedChapters,
      oldOcrResidueHits: report.oldOcrResidueHits,
      newOcrResidueHits: report.newOcrResidueHits,
    },
    null,
    2,
  ),
)
