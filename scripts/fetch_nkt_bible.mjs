// 새한글성경(NKT, 2024)을 bible.bskorea.or.kr SSR 페이지에서 장 단위로 수집한다.
// 페이지에 포함된 IBEP-main-state JSON에서 chapter 데이터만 저장하며, 재실행하면 이어받는다.
// 사용법:
//   node scripts/fetch_nkt_bible.mjs
// 산출물:
//   .tmp/nkt/booklist.json     66권 메타(코드/이름/장수) — 첫 페이지 metadata에서 추출
//   .tmp/nkt/<BOOK>.<CH>.json  장 데이터(data.chapter 부분만)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const OUT_DIR = '.tmp/nkt'
const BASE = 'https://bible.bskorea.or.kr/bible/NKT'
const DELAY_MS = 350
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function unescapeHtml(text) {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function extractState(html) {
  const match = html.match(
    /<script id="IBEP-main-state" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!match) throw new Error('IBEP-main-state script not found')
  try {
    return JSON.parse(match[1])
  } catch {
    return JSON.parse(unescapeHtml(match[1]))
  }
}

async function fetchPage(chapterId, attempt = 1) {
  try {
    const res = await fetch(`${BASE}/${chapterId}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const state = extractState(html)
    const key = Object.keys(state).find((k) => k.includes(`/chapters/${chapterId}/`))
    if (!key) throw new Error('chapter state key not found')
    const chapter = state[key]?.data?.chapter
    if (!chapter?.content) throw new Error('chapter content missing')
    return { state, chapter }
  } catch (error) {
    if (attempt >= 4) throw error
    console.error(`retry ${chapterId} (${attempt}): ${error.message}`)
    await sleep(attempt * 2500)
    return fetchPage(chapterId, attempt + 1)
  }
}

await mkdir(OUT_DIR, { recursive: true })

// 1) 책 목록 확보 — 첫 페이지의 bible metadata에서 추출(코드/이름/장수 원천 일치 보장)
const booklistPath = `${OUT_DIR}/booklist.json`
let booklist
if (existsSync(booklistPath)) {
  booklist = JSON.parse(await readFile(booklistPath, 'utf8'))
} else {
  const { state } = await fetchPage('GEN.1')
  const metaKey = Object.keys(state).find((k) => k.includes('/metadata'))
  const meta = state[metaKey]?.data
  if (!meta?.testaments) throw new Error('bible metadata not found')
  booklist = meta.testaments.flatMap((testament) =>
    testament.books.map((book) => ({
      code: book.id,
      abbr: book.abbreviation,
      name: book.name,
      chapters: book.chapters.map((chapterInfo) => chapterInfo.id),
    })),
  )
  if (booklist.length !== 66) throw new Error(`expected 66 books, got ${booklist.length}`)
  await writeFile(booklistPath, JSON.stringify(booklist, null, 1) + '\n')
}

// 2) 장 단위 수집 — 이미 저장된 장은 건너뛴다(이어받기)
const chapterIds = booklist.flatMap((book) => book.chapters)
console.log(`books=${booklist.length} chapters=${chapterIds.length}`)
const failures = []
let fetched = 0
let skipped = 0

for (const chapterId of chapterIds) {
  const outPath = `${OUT_DIR}/${chapterId}.json`
  if (existsSync(outPath)) {
    skipped += 1
    continue
  }
  try {
    const { chapter } = await fetchPage(chapterId)
    await writeFile(outPath, JSON.stringify(chapter) + '\n')
    fetched += 1
    if (fetched % 50 === 0) console.log(`progress: fetched=${fetched} skipped=${skipped}`)
    await sleep(DELAY_MS)
  } catch (error) {
    failures.push({ chapterId, error: error.message })
    console.error(`FAIL ${chapterId}: ${error.message}`)
  }
}

console.log(JSON.stringify({ fetched, skipped, failures }, null, 1))
if (failures.length > 0) process.exit(1)
