// 서로 다른 두 스캔본의 판독을 맞대어 구약 오탈자를 고친다.
//
// 같은 번역을 두 번 스캔해 둔 것이 있다.
//   새 스캔: 2026년 400DPI (rebuild/out/ot-chapters.jsonl)
//   옛 스캔: 2024년 다른 판본을 Epson으로 뜬 것 (bible/work/txt/ot)
// 다른 책·다른 스캐너·다른 시점이라 두 판독의 오류는 겹치지 않는다. 그래서 둘이 같은 글자로
// 일치하는데 지금 본문만 다르면, 틀린 쪽은 지금 본문이다.
//
// 앞서 쓴 fix_ot_typos.mjs는 같은 스캔을 두 엔진으로 읽은 것이라 근거가 이보다 약했다.
//
// 사용법:
//   node scripts/fix_ot_by_scans.mjs                # 후보만
//   node scripts/fix_ot_by_scans.mjs --write        # 반영
//   node scripts/fix_ot_by_scans.mjs --books 30,35  # 특정 책만
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const GAE_PATH = 'data/bible-chapters.gae.jsonl'
const SAE_PATH = 'data/bible-chapters.sae.jsonl'
const REBUILT_PATH = '/home/easy/bible/rebuild/out/ot-chapters.jsonl'
/* 옛 스캔은 두 벌로 나뉘어 있다. ot만으로는 구약의 절반뿐이라 전권을 담은 etc까지 함께 읽는다. */
const OLD_SCAN_DIRS = ['/home/easy/bible/work/txt/ot', '/home/easy/bible/work/txt/etc']
const KO_DICT_PATH = '/usr/share/hunspell/ko.dic'
const REPORT_PATH = '.tmp/ot-scan-vote-report.json'

/** 사용자가 제외를 지시한 책 */
const EXCLUDED_BOOKS = new Set([39])

const GRAM = 10
/** 앵커 사이 빈틈이 이보다 길면 정렬이 헐거운 구간이라 보고 건너뛴다 */
const MAX_GAP = 12

const HANGUL = /[가-힣]/

export function normalize(text) {
  let out = ''
  const map = []
  for (let i = 0; i < text.length; i += 1) {
    if (HANGUL.test(text[i])) {
      out += text[i]
      map.push(i)
    }
  }
  return { text: out, map }
}

async function readJsonl(path) {
  const raw = await readFile(path, 'utf8')
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
}

function longestIncreasing(pairs) {
  if (pairs.length === 0) return []
  const tails = []
  const tailIndex = []
  const prev = new Array(pairs.length).fill(-1)
  for (let i = 0; i < pairs.length; i += 1) {
    const value = pairs[i][1]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid] < value) lo = mid + 1
      else hi = mid
    }
    tails[lo] = value
    tailIndex[lo] = i
    prev[i] = lo > 0 ? tailIndex[lo - 1] : -1
  }
  const out = []
  for (let at = tailIndex[tails.length - 1]; at >= 0; at = prev[at]) out.push(pairs[at])
  return out.reverse()
}

/** src의 12-그램이 dst에서 딱 한 번 나오는 자리를 앵커로 삼아 위치를 맞춘다 */
export function anchor(src, dst) {
  const seen = new Map()
  for (let i = 0; i + GRAM <= dst.length; i += 1) {
    const key = dst.slice(i, i + GRAM)
    seen.set(key, seen.has(key) ? -1 : i)
  }
  const pairs = []
  for (let i = 0; i + GRAM <= src.length; i += 1) {
    const at = seen.get(src.slice(i, i + GRAM))
    if (at !== undefined && at >= 0) pairs.push([i, at])
  }
  return longestIncreasing(pairs)
}

/** 앵커 사이 빈틈에서 길이가 같은 구간만 골라 한 글자 치환 후보를 모은다 */
export function singleCharDiffs(src, dst, anchors) {
  const out = new Map()
  for (let i = 0; i + 1 < anchors.length; i += 1) {
    const from = anchors[i][0] + GRAM
    const to = anchors[i][1] + GRAM
    const length = anchors[i + 1][0] - from
    if (length <= 0 || length !== anchors[i + 1][1] - to || length > MAX_GAP) continue
    for (let k = 0; k < length; k += 1) {
      if (src[from + k] !== dst[to + k]) out.set(from + k, dst[to + k])
    }
  }
  return out
}

async function loadKoreanDictionary() {
  try {
    const raw = await readFile(KO_DICT_PATH, 'utf8')
    const words = new Set()
    for (const line of raw.split('\n')) {
      const word = line.split('/')[0].trim().normalize('NFC')
      if (word.length >= 2) words.add(word)
    }
    return words
  } catch {
    return null
  }
}

export function knownKorean(word, dictionary) {
  if (!dictionary) return false
  if (dictionary.has(word)) return true
  for (let length = word.length - 1; length >= 2; length -= 1) {
    if (word.length - length > 3) break
    if (dictionary.has(word.slice(0, length))) return true
  }
  return false
}

function buildCorpus(rows) {
  const corpus = new Set()
  for (const row of rows) {
    const cleaned = row.text.replace(/\[\[|\]\]|\((?:\d{1,3})(?:[-~]\d{1,3})?\)/g, ' ')
    for (const raw of cleaned.split(/\s+/)) {
      const word = raw.replace(/^[^가-힣]+|[^가-힣]+$/g, '')
      if (word.length >= 2) corpus.add(word)
    }
  }
  return corpus
}

function wordAt(text, index) {
  let start = index
  let end = index
  while (start > 0 && HANGUL.test(text[start - 1])) start -= 1
  while (end + 1 < text.length && HANGUL.test(text[end + 1])) end += 1
  return [start, end + 1]
}

async function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const only = argv.includes('--books')
    ? new Set(argv[argv.indexOf('--books') + 1].split(',').map(Number))
    : null

  const rows = await readJsonl(CHAPTERS_PATH)
  const rebuilt = new Map(
    (await readJsonl(REBUILT_PATH)).map((row) => [`${row.book_order}:${row.chapter}`, row.text]),
  )
  const korean = await loadKoreanDictionary()
  const corpus = buildCorpus([
    ...(await readJsonl(GAE_PATH)),
    ...(await readJsonl(SAE_PATH)),
    ...rows.filter((row) => row.book_order >= 40),
  ])

  // 장별 대조 어절 — 같은 장의 개역개정·새번역에 실제로 있는 말
  const perChapter = new Map()
  for (const row of [...(await readJsonl(GAE_PATH)), ...(await readJsonl(SAE_PATH))]) {
    const key = `${row.book_order}:${row.chapter}`
    const set = perChapter.get(key) ?? new Set()
    const cleaned = row.text.replace(/\[\[|\]\]|\((?:\d{1,3})(?:[-~]\d{1,3})?\)/g, ' ')
    for (const raw of cleaned.split(/\s+/)) {
      const word = raw.replace(/^[^가-힣]+|[^가-힣]+$/g, '')
      if (word.length >= 2) set.add(word)
    }
    perChapter.set(key, set)
  }

  // 옛 스캔은 쪽 단위 텍스트다. 구약 전체를 한 줄로 이어 붙여 놓고 책마다 붙인다.
  let oldText = ''
  for (const dir of OLD_SCAN_DIRS) {
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.txt')).sort()) {
      oldText += await readFile(`${dir}/${file}`, 'utf8')
    }
  }
  const oldStream = normalize(oldText).text

  const targets = rows.filter(
    (row) => row.book_order <= 39 && !EXCLUDED_BOOKS.has(row.book_order) && (!only || only.has(row.book_order)),
  )

  const byBook = new Map()
  for (const row of targets) {
    if (!byBook.has(row.book_order)) byBook.set(row.book_order, [])
    byBook.get(row.book_order).push(row)
  }

  const fixes = []
  for (const [order, chapters] of byBook) {
    chapters.sort((a, b) => a.chapter - b.chapter)

    // 책 한 권을 통째로 옛 스캔에 붙인 뒤, 장 구간을 잘라 쓴다
    const parts = chapters.map((row) => normalize(row.text))
    let bookStream = ''
    const spans = []
    for (const part of parts) {
      spans.push([bookStream.length, bookStream.length + part.text.length])
      bookStream += part.text
    }
    const byOld = singleCharDiffs(bookStream, oldStream, anchor(bookStream, oldStream))

    for (const [position, row] of chapters.entries()) {
      const rebuiltText = rebuilt.get(`${row.book_order}:${row.chapter}`)
      if (!rebuiltText) continue
      const part = parts[position]
      const fresh = normalize(rebuiltText).text
      const byNew = singleCharDiffs(part.text, fresh, anchor(part.text, fresh))

      for (const [at, replacement] of byNew) {
        // 두 스캔이 같은 글자로 일치할 때만 본다
        if (byOld.get(spans[position][0] + at) !== replacement) continue

        const index = part.map[at]
        if (index === undefined) continue
        const [start, end] = wordAt(row.text, index)
        const word = row.text.slice(start, end)
        if (word.length < 2) continue
        const fixed = `${row.text.slice(start, index)}${replacement}${row.text.slice(index + 1, end)}`

        // 지금 어절이 이미 말이 되면 건드리지 않는다. 고친 쪽은 실제로 쓰이는 말이어야 한다.
        if (knownKorean(word, korean) || corpus.has(word)) continue
        // 고친 말은 표준 한국어이거나, 같은 장의 개역개정·새번역에 실제로 있는 말이어야 한다.
        // 성경 어디엔가 있다는 것만으로는 이 자리에 맞다는 근거가 못 된다.
        const here = perChapter.get(`${row.book_order}:${row.chapter}`)
        if (!knownKorean(fixed, korean) && !(here && here.has(fixed))) continue

        fixes.push({
          book: row.book,
          book_order: row.book_order,
          chapter: row.chapter,
          index,
          start,
          from: row.text[index],
          to: replacement,
          word,
          fixed,
        })
      }
    }
  }

  // 한 어절에서 여러 글자가 동시에 걸리면 정렬이 어긋난 구간이다 — 통째로 버린다
  const perWord = new Map()
  for (const fix of fixes) {
    const key = `${fix.book_order}:${fix.chapter}:${fix.start}`
    perWord.set(key, (perWord.get(key) ?? 0) + 1)
  }
  const applied = fixes.filter((fix) => perWord.get(`${fix.book_order}:${fix.chapter}:${fix.start}`) === 1)

  console.log(`두 스캔이 합의한 교정 ${applied.length}건 (한 어절 다중 후보 ${fixes.length - applied.length}건 제외)`)
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(applied, null, 2)}\n`)
  console.log(`리포트: ${REPORT_PATH}`)
  for (const fix of applied.slice(0, 12)) console.log(`  ${fix.book} ${fix.chapter}: ${fix.word} → ${fix.fixed}`)

  if (!write) return

  const byChapter = new Map()
  for (const fix of applied) {
    const key = `${fix.book_order}:${fix.chapter}`
    if (!byChapter.has(key)) byChapter.set(key, [])
    byChapter.get(key).push(fix)
  }
  let count = 0
  const lines = rows.map((row) => {
    const list = byChapter.get(`${row.book_order}:${row.chapter}`)
    if (!list) return JSON.stringify(row)
    const chars = [...row.text]
    for (const fix of list) {
      if (chars[fix.index] !== fix.from) continue
      chars[fix.index] = fix.to
      count += 1
    }
    return JSON.stringify({ ...row, text: chars.join('') })
  })
  await writeFile(CHAPTERS_PATH, `${lines.join('\n')}\n`)
  console.log(`${CHAPTERS_PATH} 갱신: ${count}자 교정`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
