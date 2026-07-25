// The Message(MSG) 영어 성경을 bolls.life 덤프에서 앱 데이터 포맷으로 변환한다.
// 원본: https://bolls.life/static/translations/MSG.json (get-books: https://bolls.life/get-books/MSG/)
// 사용법:
//   curl -L -o .tmp/MSG.json https://bolls.life/static/translations/MSG.json
//   node scripts/import_msg_bible.mjs [.tmp/MSG.json]
// 산출물:
//   data/bible-books.en.json     66권 영어 메타데이터
//   data/bible-chapters.en.jsonl 장 단위 본문 원본 (한국어 bible-chapters.jsonl과 같은 스키마)
import { readFile, writeFile } from 'node:fs/promises'

const SOURCE_PATH = process.argv[2] ?? '.tmp/MSG.json'
const KO_BOOKS_PATH = 'data/bible-books.json'
const OUT_BOOKS_PATH = 'data/bible-books.en.json'
const OUT_CHAPTERS_PATH = 'data/bible-chapters.en.jsonl'

// order(=bolls bookid)와 표준 영어 책명/약어. 장수는 한국어 메타데이터와 교차 검증한다.
const EN_BOOKS = [
  ['Genesis', 'Gen'],
  ['Exodus', 'Exod'],
  ['Leviticus', 'Lev'],
  ['Numbers', 'Num'],
  ['Deuteronomy', 'Deut'],
  ['Joshua', 'Josh'],
  ['Judges', 'Judg'],
  ['Ruth', 'Ruth'],
  ['1 Samuel', '1Sam'],
  ['2 Samuel', '2Sam'],
  ['1 Kings', '1Kgs'],
  ['2 Kings', '2Kgs'],
  ['1 Chronicles', '1Chr'],
  ['2 Chronicles', '2Chr'],
  ['Ezra', 'Ezra'],
  ['Nehemiah', 'Neh'],
  ['Esther', 'Esth'],
  ['Job', 'Job'],
  ['Psalms', 'Ps'],
  ['Proverbs', 'Prov'],
  ['Ecclesiastes', 'Eccl'],
  ['Song of Solomon', 'Song'],
  ['Isaiah', 'Isa'],
  ['Jeremiah', 'Jer'],
  ['Lamentations', 'Lam'],
  ['Ezekiel', 'Ezek'],
  ['Daniel', 'Dan'],
  ['Hosea', 'Hos'],
  ['Joel', 'Joel'],
  ['Amos', 'Amos'],
  ['Obadiah', 'Obad'],
  ['Jonah', 'Jonah'],
  ['Micah', 'Mic'],
  ['Nahum', 'Nah'],
  ['Habakkuk', 'Hab'],
  ['Zephaniah', 'Zeph'],
  ['Haggai', 'Hag'],
  ['Zechariah', 'Zech'],
  ['Malachi', 'Mal'],
  ['Matthew', 'Matt'],
  ['Mark', 'Mark'],
  ['Luke', 'Luke'],
  ['John', 'John'],
  ['Acts', 'Acts'],
  ['Romans', 'Rom'],
  ['1 Corinthians', '1Cor'],
  ['2 Corinthians', '2Cor'],
  ['Galatians', 'Gal'],
  ['Ephesians', 'Eph'],
  ['Philippians', 'Phil'],
  ['Colossians', 'Col'],
  ['1 Thessalonians', '1Thess'],
  ['2 Thessalonians', '2Thess'],
  ['1 Timothy', '1Tim'],
  ['2 Timothy', '2Tim'],
  ['Titus', 'Titus'],
  ['Philemon', 'Phlm'],
  ['Hebrews', 'Heb'],
  ['James', 'Jas'],
  ['1 Peter', '1Pet'],
  ['2 Peter', '2Pet'],
  ['1 John', '1John'],
  ['2 John', '2John'],
  ['3 John', '3John'],
  ['Jude', 'Jude'],
  ['Revelation', 'Rev'],
]

// public/bible 검증 규칙(validate-bible.mjs disallowedSpecialChars)과 충돌하지 않도록 정리한다.
function cleanVerseText(raw) {
  return raw
    .replace(/<br\s*\/?>/g, ' ') // 절 내부 줄바꿈은 공백으로 — 한국어 본문과 같은 문단 흐름 유지
    .replace(/<\/?[a-zA-Z][^>]*>|<\/>/g, ' ') // 그 외 태그 잔재 제거(마 16:6의 '</>' 포함)
    .replace(/\^/g, '') // 각주 마커 잔재(수 1:18)
    .replace(/\s+/g, ' ')
    .trim()
}

const [rows, koBooks] = await Promise.all([
  readFile(SOURCE_PATH, 'utf8').then(JSON.parse),
  readFile(KO_BOOKS_PATH, 'utf8').then(JSON.parse),
])

if (EN_BOOKS.length !== 66 || koBooks.length !== 66) {
  throw new Error(`book metadata must have 66 entries (en=${EN_BOOKS.length}, ko=${koBooks.length})`)
}

const books = EN_BOOKS.map(([book, abbr], i) => ({
  order: i + 1,
  book,
  abbr,
  file: `${String(i + 1).padStart(2, '0')}_${abbr}.json`,
  standardChapters: koBooks[i].standardChapters,
}))

const byBook = new Map()
for (const row of rows) {
  if (!byBook.has(row.book)) byBook.set(row.book, new Map())
  const byChapter = byBook.get(row.book)
  if (!byChapter.has(row.chapter)) byChapter.set(row.chapter, [])
  byChapter.get(row.chapter).push(row)
}

const issues = []
const lines = []
let chapterCount = 0

for (const book of books) {
  const byChapter = byBook.get(book.order)
  if (!byChapter) {
    issues.push({ book: book.book, issue: 'missing-book' })
    continue
  }
  if (byChapter.size !== book.standardChapters) {
    issues.push({ book: book.book, issue: 'chapter-count', actual: byChapter.size, expected: book.standardChapters })
  }
  for (let chapter = 1; chapter <= book.standardChapters; chapter += 1) {
    const verses = (byChapter.get(chapter) ?? []).sort((a, b) => a.verse - b.verse)
    if (verses.length === 0) {
      issues.push({ book: book.book, chapter, issue: 'empty-chapter' })
      continue
    }
    const text = verses.map((verse) => `(${verse.verse}) ${cleanVerseText(verse.text)}`).join('\n')
    if (/[%\u200b{}#〉*>※^<@+\\|＊》]/.test(text)) {
      issues.push({ book: book.book, chapter, issue: 'disallowed-character' })
    }
    lines.push(
      JSON.stringify({
        book_order: book.order,
        book: book.book,
        abbr: book.abbr,
        file: book.file,
        chapter,
        text,
        // 디지털 원문 기반이라 스캔 검증 불필요 — 앱 타입('verified'|'fallback')과도 일치시킨다.
        source_quality: 'verified',
      }),
    )
    chapterCount += 1
  }
}

if (issues.length > 0) {
  console.error(JSON.stringify({ issues }, null, 2))
  process.exit(1)
}

await writeFile(OUT_BOOKS_PATH, JSON.stringify(books, null, 2) + '\n')
await writeFile(OUT_CHAPTERS_PATH, lines.join('\n') + '\n')
console.log(JSON.stringify({ books: books.length, chapters: chapterCount, verses: rows.length }, null, 2))
