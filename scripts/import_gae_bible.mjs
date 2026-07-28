// 개역개정(GAE)·새번역(SAENEW) 본문을 dev-dooD/bible-crawler 덤프에서 앱 데이터 포맷으로 변환한다.
// 원본: https://raw.githubusercontent.com/dev-dooD/bible-crawler/bcff2fb24e8ae359df6c7b609be0d46bfe807051/bible_data.json
//   (덤프 스키마: books[] -> chapters[] -> verses[] -> text.{GAE,SAENEW} / subtitle.{GAE,SAENEW})
// 사용법:
//   curl -L -o .tmp/bible-crawler.json <위 URL>
//   node scripts/import_gae_bible.mjs [.tmp/bible-crawler.json]            # 개역개정 → gae
//   node scripts/import_gae_bible.mjs --version sae [.tmp/bible-crawler.json]  # 새번역 → sae
// 산출물:
//   data/bible-chapters.<version>.jsonl  장 단위 본문(기존 bible-chapters.jsonl과 같은 스키마)
// 책 메타데이터는 기존 data/bible-books.json(한국어)을 그대로 공유한다.
import { readFile, writeFile } from 'node:fs/promises'

const VERSION_KEYS = { gae: 'GAE', sae: 'SAENEW' }
const versionIndex = process.argv.indexOf('--version')
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : 'gae'
const sourceKey = VERSION_KEYS[version]
if (!sourceKey) {
  console.error(`unsupported version: ${version}`)
  process.exit(1)
}

const positional = process.argv.slice(2).filter((arg, i, args) => arg !== '--version' && args[i - 1] !== '--version')
const SOURCE_PATH = positional[0] ?? '.tmp/bible-crawler.json'
const KO_BOOKS_PATH = 'data/bible-books.json'
const OUT_CHAPTERS_PATH = `data/bible-chapters.${version}.jsonl`

// public/bible 검증 규칙(validate-bible.mjs disallowedSpecialChars)과 충돌하지 않게 정리한다.
function cleanText(raw) {
  return raw
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const [dump, koBooks] = await Promise.all([
  readFile(SOURCE_PATH, 'utf8').then(JSON.parse),
  readFile(KO_BOOKS_PATH, 'utf8').then(JSON.parse),
])

const sourceBooks = dump.books
if (!Array.isArray(sourceBooks) || sourceBooks.length !== 66 || koBooks.length !== 66) {
  throw new Error(`book metadata must have 66 entries (source=${sourceBooks?.length}, ko=${koBooks.length})`)
}

const issues = []
const skippedEmpty = []
const lines = []
let chapterCount = 0
let verseCount = 0

for (const [index, book] of koBooks.entries()) {
  const source = sourceBooks[index]
  // 표기 차이(요한1서/요한일서)만 흡수하고 순서 불일치는 실패로 취급한다.
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
  for (const chapter of source.chapters) {
    const parts = []
    for (const verse of chapter.verses) {
      const text = cleanText(verse.text?.[sourceKey] ?? '')
      if (!text) {
        // 역본 간 절 구분 차이(계 12:18)나 본문비평상 생략 절(새번역의 마 17:21 등)은 건너뛴다.
        skippedEmpty.push(`${book.book} ${chapter.chapter}:${verse.verse}`)
        continue
      }
      const subtitle = cleanText(verse.subtitle?.[sourceKey] ?? '')
      if (subtitle) parts.push(`[[${subtitle}]]`)
      parts.push(`(${verse.verse}) ${text}`)
      verseCount += 1
    }
    if (parts.length === 0) {
      issues.push({ book: book.book, chapter: chapter.chapter, issue: 'empty-chapter' })
      continue
    }
    const text = parts.join('\n')
    if (/[%\u200b{}#〉*>※^<@+\\|＊》]/.test(text)) {
      issues.push({ book: book.book, chapter: chapter.chapter, issue: 'disallowed-character' })
    }
    lines.push(
      JSON.stringify({
        book_order: book.order,
        book: book.book,
        abbr: book.abbr,
        file: book.file,
        chapter: chapter.chapter,
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

await writeFile(OUT_CHAPTERS_PATH, lines.join('\n') + '\n')
console.log(JSON.stringify({ chapters: chapterCount, verses: verseCount, skippedEmpty }, null, 2))
