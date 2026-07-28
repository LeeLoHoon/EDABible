// 새한글성경(NKT)을 fetch_nkt_bible.mjs가 저장한 장 데이터에서 앱 데이터 포맷으로 변환한다.
// 장 데이터 스키마: content[] = { style: s|r|d|p|q*|m..., content: [verse-number|verse-text|text|study|ref] }
// 사용법:
//   node scripts/fetch_nkt_bible.mjs   (선행 — .tmp/nkt/ 채우기)
//   node scripts/import_nkt_bible.mjs
// 산출물:
//   data/bible-chapters.nkt.jsonl  장 단위 본문(기존 bible-chapters.jsonl과 같은 스키마)
import { readFile, writeFile } from 'node:fs/promises'

const SRC_DIR = '.tmp/nkt'
const KO_BOOKS_PATH = 'data/bible-books.json'
const OUT_CHAPTERS_PATH = 'data/bible-chapters.nkt.jsonl'

// 소제목 계열 스타일 — [[제목]] 라인으로 변환한다
const HEADING_STYLES = new Set(['s', 's1', 's2', 'ms', 'ms1', 'ms2', 'mr', 'sp'])
// 병행 본문 참조(예: "마 3:1-12; 막 1:1-8") — 본문이 아니므로 제외한다
const SKIP_STYLES = new Set(['r', 'b'])

function clean(raw) {
  return String(raw ?? '')
    .replace(/\u200b/g, '')
    .replace(/[*+]/g, '') // 각주 마커 잔재(대상 15:24, 시 9편) — import_msg_bible의 '^' 제거와 같은 접근
    .replace(/\s+/g, ' ')
    .trim()
}

function textOf(block) {
  return clean(
    (block.content ?? [])
      .filter((item) => item.type === 'text' || item.type === 'verse-text')
      .map((item) => item.content)
      .join(' '),
  )
}

function convertChapter(chapter, report) {
  const lines = []
  let current = null

  const flush = () => {
    if (!current) return
    const text = clean(current.parts.join(' '))
    if (text) lines.push(`(${current.label}) ${text}`)
    else report.emptyVerses.push(current.label)
    current = null
  }

  for (const block of chapter.content) {
    const style = block.style ?? block.type
    if (SKIP_STYLES.has(style)) {
      report.skippedBlocks += 1
      continue
    }
    if (HEADING_STYLES.has(style)) {
      flush()
      const heading = textOf(block)
      if (heading) lines.push(`[[${heading}]]`)
      continue
    }
    if (!Array.isArray(block.content)) {
      report.unknownStyles.add(`${style}(no-content)`)
      continue
    }
    // 'd'(시편 표제)는 새한글성경에서 1절 번호를 포함하므로 일반 본문 경로로 처리한다
    if (!['p', 'm', 'pi', 'pc', 'li', 'li1', 'li2', 'q', 'q1', 'q2', 'q3', 'qr', 'qc', 'qa', 'nb', 'pm', 'pmo', 'mi', 'd'].includes(style)) {
      report.unknownStyles.add(style)
    }
    for (const item of block.content) {
      if (item.type === 'verse-number') {
        flush()
        current = { label: clean(item.content), parts: [] }
      } else if (item.type === 'verse-text' || item.type === 'text') {
        if (current) current.parts.push(item.content)
        else {
          const stray = clean(item.content)
          if (stray) lines.push(stray)
        }
      }
    }
  }
  flush()
  return lines
}

const booklist = JSON.parse(await readFile(`${SRC_DIR}/booklist.json`, 'utf8'))
const koBooks = JSON.parse(await readFile(KO_BOOKS_PATH, 'utf8'))
if (booklist.length !== 66 || koBooks.length !== 66) {
  throw new Error(`book metadata must have 66 entries (nkt=${booklist.length}, ko=${koBooks.length})`)
}

const issues = []
const jsonlLines = []
const unknownStyles = new Set()
let chapterCount = 0
let verseCount = 0

for (const [index, book] of koBooks.entries()) {
  const source = booklist[index]
  const normalizedName = source.name
    .replace('요한1서', '요한일서')
    .replace('요한2서', '요한이서')
    .replace('요한3서', '요한삼서')
  if (normalizedName !== book.book) {
    issues.push({ book: book.book, issue: 'book-order-mismatch', source: source.name })
    continue
  }
  if (source.chapters.length !== book.standardChapters) {
    issues.push({
      book: book.book,
      issue: 'chapter-count',
      actual: source.chapters.length,
      expected: book.standardChapters,
    })
  }
  for (const chapterId of source.chapters) {
    const chapterNumber = Number(chapterId.split('.')[1])
    let chapter
    try {
      chapter = JSON.parse(await readFile(`${SRC_DIR}/${chapterId}.json`, 'utf8'))
    } catch {
      issues.push({ book: book.book, chapter: chapterNumber, issue: 'missing-chapter-file', chapterId })
      continue
    }
    const report = { skippedBlocks: 0, emptyVerses: [], unknownStyles }
    const lines = convertChapter(chapter, report)
    const emitted = lines.filter((line) => /^\(\d/.test(line)).length
    if (report.emptyVerses.length > 0) {
      issues.push({ book: book.book, chapter: chapterNumber, issue: 'empty-verse', verses: report.emptyVerses })
    }
    if (chapter.verseCount && emitted !== chapter.verseCount) {
      issues.push({
        book: book.book,
        chapter: chapterNumber,
        issue: 'verse-count',
        actual: emitted,
        expected: chapter.verseCount,
      })
    }
    if (lines.length === 0) {
      issues.push({ book: book.book, chapter: chapterNumber, issue: 'empty-chapter' })
      continue
    }
    const text = lines.join('\n')
    if (/[%\u200b{}#〉*>※^<@+\\|＊》]/.test(text)) {
      issues.push({ book: book.book, chapter: chapterNumber, issue: 'disallowed-character' })
    }
    jsonlLines.push(
      JSON.stringify({
        book_order: book.order,
        book: book.book,
        abbr: book.abbr,
        file: book.file,
        chapter: chapterNumber,
        text,
        source_quality: 'verified',
      }),
    )
    chapterCount += 1
    verseCount += emitted
  }
}

if (issues.length > 0) {
  console.error(JSON.stringify({ issueCount: issues.length, issues: issues.slice(0, 30) }, null, 2))
  process.exit(1)
}

await writeFile(OUT_CHAPTERS_PATH, jsonlLines.join('\n') + '\n')
console.log(
  JSON.stringify(
    { chapters: chapterCount, verses: verseCount, unknownStyles: [...unknownStyles] },
    null,
    2,
  ),
)
