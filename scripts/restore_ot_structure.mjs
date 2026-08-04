// 구약 메시지성경 본문에 절 마커·문단 구조를 복원한다.
//
// 앱 본문(data/bible-chapters.jsonl)의 구약 fallback 장들은 절 번호도 문단도 없는 통짜 텍스트다.
// 같은 스캔의 원본 OCR(ocr_paddle)에는 장 드롭캡과 절 번호가 남아 있으므로, 글자는 그대로 두고
// 구조만 얹는다. 위치는 정렬로 찾으므로 박스 해설·각주처럼 앱 본문에 없는 조판 요소는 자연히 빠진다.
//
// 사용법:
//   node scripts/restore_ot_structure.mjs --book 18            # 파일럿(욥기) 리포트만
//   node scripts/restore_ot_structure.mjs --all                # 구약 fallback 전량 시뮬레이션
//   node scripts/restore_ot_structure.mjs --all --write        # jsonl 반영
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const PADDLE_DIR = process.env.PADDLE_DIR ?? '/home/easy/bible/new/ocr_paddle'
export const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
export const GAE_PATH = 'data/bible-chapters.gae.jsonl'
export const REPORT_PATH = '.tmp/ot-restore-report.json'

/** 스캔 PDF별 수록 범위(book_order) — 정경 순서는 a → d → b → c → e */
export const PDF_BOOKS = [
  ['a', 1, 5],
  ['d', 6, 17],
  ['b', 18, 22],
  ['c', 23, 39],
  ['e', 40, 66],
]

/** 한 장이 가질 수 있는 최대 절 수(시편 119편) — 페이지 번호를 절로 오인하는 것을 막는다 */
const MAX_VERSE = 176

/* ------------------------------------------------------------------ 정규화 */

const HANGUL = /[가-힣]/

/** 정렬용 정규화 — 한글 음절만 남긴다. OCR 잡음(라틴·기호·공백·낱자모)이 사라져 정렬이 안정된다. */
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

export async function readJsonl(path) {
  const raw = await readFile(path, 'utf8')
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/* -------------------------------------------------------- OCR 스트림 구성 */

const NUMBER_BOX = /^(\d{1,3})(?:-(\d{1,3}))?$/
const VERSE_LEAD = /^(\d{1,3})(?:-(\d{1,3}))?\s*(?=[가-힣“”"'(])/

function parseVerse(first, last) {
  const start = Number(first)
  const end = last === undefined ? start : Number(last)
  if (!start || start > MAX_VERSE || end > MAX_VERSE || end < start) return null
  if (first.length > 1 && first.startsWith('0')) return null // 러닝헤더의 페이지 번호(예: 052)
  return last === undefined ? `${start}` : `${start}-${end}`
}

/** 크롭 4분할의 읽기 순서: q1(좌상) → q2(좌하) → q3(우상) → q4(우하) */
function readingOrder(items) {
  return [...items].sort((a, b) => a.q - b.q || a.box[1] - b.box[1] || a.box[0] - b.box[0])
}

/**
 * 페이지의 박스를 "본문 줄" 단위로 묶는다.
 * 숫자만 있는 박스는 줄이 아니라 바로 뒤 본문 줄에 붙는 표지(장 드롭캡/절 번호)로 취급한다.
 */
function pageLines(items, page) {
  const lines = []
  let pendingChapter = null
  let pendingVerse = null

  // 본문 단의 좌우 경계 — 여백에 찍힌 각주 번호·얼룩을 절 번호로 오인하지 않으려면 필요하다
  const columns = new Map()
  for (const item of items) {
    if (!HANGUL.test(item.text)) continue
    const [x0, , x1] = item.box
    const bounds = columns.get(item.q) ?? { left: Infinity, right: -Infinity }
    bounds.left = Math.min(bounds.left, x0)
    bounds.right = Math.max(bounds.right, x1)
    columns.set(item.q, bounds)
  }

  for (const item of readingOrder(items)) {
    const [x0, y0, x1, y1] = item.box
    const width = x1 - x0
    const height = y1 - y0
    const text = item.text.trim()
    if (!text) continue

    const number = text.match(NUMBER_BOX)
    if (number) {
      const bounds = columns.get(item.q)
      // 단 바깥(여백)의 숫자는 각주 번호다 — 본문 단 안에 있는 것만 절/장 표지로 본다
      if (!bounds || x0 < bounds.left - 25 || x1 > bounds.right + 10) continue
      // 드롭캡은 본문 글자의 두 배 이상 크다 (본문 h≈35-45, 드롭캡 h≈80-100)
      if (height >= 60 && !number[2]) pendingChapter = Number(number[1])
      else pendingVerse = parseVerse(number[1], number[2]) ?? pendingVerse
      continue
    }

    const norm = normalize(text).text
    if (norm.length === 0) continue // 여백 얼룩·기호 박스

    const lead = text.match(VERSE_LEAD)
    const verse = lead ? parseVerse(lead[1], lead[2]) : null

    lines.push({
      text,
      norm,
      page,
      width,
      height,
      chapter: pendingChapter,
      verse: verse ?? pendingVerse,
    })
    pendingChapter = null
    pendingVerse = null
  }

  return lines
}

/** 크롭 겹침으로 같은 줄이 두 번 잡힌다 — 최근 창 안에서 같은 내용이면 버린다(표지도 함께 버려진다) */
function dropDuplicates(lines) {
  const out = []
  const recent = new Map()
  for (const line of lines) {
    if (line.norm.length >= 6) {
      const at = recent.get(line.norm)
      if (at !== undefined && out.length - at <= 40) continue
      recent.set(line.norm, out.length)
    }
    out.push(line)
  }
  return out
}

/**
 * PDF 하나의 OCR 스트림.
 * @returns {{norm: string, events: Array<{type: string, at: number, value: string|number, page: number}>}}
 */
export async function buildStream(pdf) {
  const dir = `${PADDLE_DIR}/${pdf}`
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()

  let lines = []
  for (const file of files) {
    const page = Number(file.match(/(\d+)/)[1])
    const items = JSON.parse(await readFile(`${dir}/${file}`, 'utf8'))
    lines = lines.concat(pageLines(items, page))
  }
  lines = dropDuplicates(lines)

  let norm = ''
  const events = []
  for (const line of lines) {
    if (line.chapter !== null) {
      events.push({ type: 'chapter', at: norm.length, value: line.chapter, page: line.page })
    }
    if (line.verse) {
      events.push({ type: 'verse', at: norm.length, value: line.verse, page: line.page })
    }
    norm += line.norm
  }

  return { norm, events }
}

/* ------------------------------------------------------------- 앵커 정렬 */

const GRAM = 12

/** 스트림에서 딱 한 번 등장하는 12-그램만 앵커 후보로 삼는다 */
function uniqueGrams(text) {
  const seen = new Map()
  for (let i = 0; i + GRAM <= text.length; i += 1) {
    const key = text.slice(i, i + GRAM)
    seen.set(key, seen.has(key) ? -1 : i)
  }
  return seen
}

/** 증가하는 부분수열만 남겨 단조 앵커 사슬을 만든다 (patience diff의 핵심) */
export function longestIncreasing(pairs) {
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
  let cursor = tailIndex[tails.length - 1]
  while (cursor >= 0) {
    out.push(pairs[cursor])
    cursor = prev[cursor]
  }
  return out.reverse()
}

/**
 * src → dst 위치 대응 앵커를 만든다.
 * @returns {{anchors: Array<[number, number]>, coverage: number}} coverage는 src 기준 정렬률
 */
export function alignStreams(src, dst) {
  const dstGrams = uniqueGrams(dst)
  const pairs = []
  for (let i = 0; i + GRAM <= src.length; i += 1) {
    const at = dstGrams.get(src.slice(i, i + GRAM))
    if (at !== undefined && at >= 0) pairs.push([i, at])
  }
  const anchors = longestIncreasing(pairs)
  const covered = new Set()
  for (const [at] of anchors) for (let k = 0; k < GRAM; k += 1) covered.add(at + k)
  return { anchors, coverage: src.length > 0 ? covered.size / src.length : 0 }
}

/** 앵커의 dst 오프셋 → src 오프셋 역인덱스 (정확 대응만 담는다) */
export function inverseIndex(anchors) {
  const index = new Map()
  for (const [src, dst] of anchors) index.set(dst, src)
  return index
}

/**
 * OCR 오프셋을 앱 본문 오프셋으로 옮긴다.
 * 앵커에 정확히 걸리면 그 값을, 아니면 근처 앵커에서 보정하고, 그마저 없으면 보간한다.
 * @returns {{at: number, exact: boolean}|null}
 */
export function locate(anchors, index, offset) {
  for (let delta = 0; delta <= 8; delta += 1) {
    const hit = index.get(offset + delta)
    if (hit !== undefined) return { at: hit - delta, exact: true }
  }
  const interpolated = mapOffset(anchors.map(([src, dst]) => [dst, src]), offset)
  return interpolated === null ? null : { at: interpolated, exact: false }
}

/** 앵커 사슬로 src 오프셋 → dst 오프셋 보간 */
export function mapOffset(anchors, offset) {
  if (anchors.length === 0) return null
  const last = anchors.length - 1
  if (offset <= anchors[0][0]) return anchors[0][1] + (offset - anchors[0][0])
  if (offset >= anchors[last][0]) return anchors[last][1] + (offset - anchors[last][0])

  let lo = 0
  let hi = last
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (anchors[mid][0] <= offset) lo = mid
    else hi = mid
  }
  const [sa, da] = anchors[lo]
  const [sb, db] = anchors[hi]
  if (sb === sa) return da
  return Math.round(da + ((offset - sa) * (db - da)) / (sb - sa))
}

/* ------------------------------------------------------------ 구조 재조립 */

/** 최소 간격(정규화 글자 수) — 이보다 붙어 있는 절 마커는 OCR 잡음으로 본다 */
const MIN_GAP = 8
/** 소제목으로 인정할 도입 문구의 최대 길이 */
const HEADING_MAX = 45

/**
 * 한 장에 얹을 절 마커를 고른다.
 * 절 구간은 겹칠 수 없다는 제약(다음 절 시작 > 앞 절 끝) 아래, 끊김 없이 이어지는 조합에
 * 가산점을 주는 DP로 고른다. OCR이 잘못 읽은 번호는 이 제약과 점수에서 밀려 빠진다.
 */
export function pickMarks(events, verseCeiling) {
  const spaced = []
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    const [first, last] = event.value.split('-')
    const start = Number(first)
    const end = Number(last ?? first)
    if (verseCeiling && end > verseCeiling) continue
    if (spaced.length > 0 && event.at - spaced[spaced.length - 1].at < MIN_GAP) continue
    spaced.push({ ...event, start, end, range: last !== undefined })
  }
  if (spaced.length === 0) return []

  const weight = (event) => 1 + (event.exact ? 0.5 : 0) + (event.range ? 0.3 : 0)
  const score = spaced.map((event) => weight(event) + (event.start === 1 ? 1 : 0))
  const from = spaced.map(() => -1)

  for (let i = 0; i < spaced.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (spaced[i].start <= spaced[j].end) continue
      const bonus = spaced[i].start === spaced[j].end + 1 ? 1.5 : 0
      const candidate = score[j] + weight(spaced[i]) + bonus
      if (candidate > score[i]) {
        score[i] = candidate
        from[i] = j
      }
    }
  }

  let best = 0
  for (let i = 1; i < spaced.length; i += 1) if (score[i] > score[best]) best = i

  const chain = []
  for (let at = best; at >= 0; at = from[at]) chain.push(spaced[at])
  return chain.reverse()
}

/**
 * 원본 텍스트에 절 마커를 얹고 신약과 같은 형태(한 줄 = 한 절 그룹)로 다시 짠다.
 * 글자는 넣거나 빼지 않는다 — 공백/줄바꿈과 마커만 바뀐다.
 */
export function restoreChapter(original, marks) {
  const segments = []
  let cursor = 0
  let pending = null
  for (const mark of marks) {
    segments.push({ value: pending, text: original.slice(cursor, mark.at) })
    pending = mark.value
    cursor = mark.at
  }
  segments.push({ value: pending, text: original.slice(cursor) })

  const lines = []
  let heading = null

  for (const [index, segment] of segments.entries()) {
    const collapsed = segment.text.replace(/\s+/g, ' ').trim()
    if (!collapsed) continue

    // 이미 [[소제목]]이 박혀 있는 장이 있다 — 다시 감싸지 않고 제 줄로 떼어 낸다
    const pieces = collapsed
      .split(/(\[\[.+?\]\])/g)
      .map((piece) => piece.trim())
      .filter(Boolean)

    let marked = false
    for (const piece of pieces) {
      if (/^\[\[.+\]\]$/.test(piece)) {
        heading ??= piece.slice(2, -2).trim()
        lines.push(piece)
        continue
      }

      // 첫 절 마커 앞의 짧은 도입 문구는 소제목이다 (인쇄본에서 절 번호 위에 놓인 색 제목)
      if (index === 0 && !marked && segment.value === null && marks.length > 0 && piece.length <= HEADING_MAX) {
        heading = piece.replace(/\.$/, '')
        lines.push(`[[${heading}]]`)
        continue
      }

      lines.push(!marked && segment.value !== null ? `(${segment.value}) ${piece}` : piece)
      marked = true
    }
  }

  return { text: lines.join('\n'), heading }
}

/** 원본에 이미 박혀 있는 [[소제목]] 구간 — 그 안쪽은 마커를 넣을 수 없다 */
export function headingRanges(text) {
  const ranges = []
  for (const match of text.matchAll(/\[\[[\s\S]*?\]\]/g)) {
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

/** 소제목 안쪽에 걸린 마커는 소제목이 끝난 자리로 밀어낸다 (소제목이 줄바꿈으로 쪼개진 장이 있다) */
export function pushOutOfHeading(text, at, ranges) {
  for (const [start, end] of ranges) {
    if (at <= start || at >= end) continue
    let next = end
    while (next < text.length && /\s/.test(text[next])) next += 1
    return next
  }
  return at
}

/** 어절 한가운데 마커가 박히지 않도록 가장 가까운 어절 머리로 옮긴다 */
export function snapToWord(text, at) {
  if (at <= 0 || at >= text.length) return at
  if (/\s/.test(text[at - 1])) return at
  for (let delta = 1; delta <= 6; delta += 1) {
    if (at + delta < text.length && /\s/.test(text[at + delta - 1])) return at + delta
    if (at - delta > 0 && /\s/.test(text[at - delta - 1])) return at - delta
  }
  return at
}

/** 개역개정 본문의 (N) 마커에서 장별 절 수 상한을 얻는다 */
export function verseCeilings(rows) {
  const ceilings = new Map()
  for (const row of rows) {
    let max = 0
    for (const match of row.text.matchAll(/\((\d{1,3})\)/g)) max = Math.max(max, Number(match[1]))
    if (max > 0) ceilings.set(`${row.book_order}:${row.chapter}`, max)
  }
  return ceilings
}

/* --------------------------------------------------------------- 실행부 */

/** 스캔 PDF 한 권을 훑어 대상 장들의 복원 결과를 만든다 */
export async function restorePdf(pdf, from, to, rows, ceilings, isTarget) {
  const books = rows
    .filter((row) => row.book_order >= from && row.book_order <= to)
    .sort((a, b) => a.book_order - b.book_order || a.chapter - b.chapter)
  if (books.length === 0) return []

  const stream = await buildStream(pdf)
  const parts = books.map((row) => normalize(row.text))

  let appNorm = ''
  const spans = []
  for (const part of parts) {
    spans.push([appNorm.length, appNorm.length + part.text.length])
    appNorm += part.text
  }

  const { anchors, coverage } = alignStreams(appNorm, stream.norm)
  const index = inverseIndex(anchors)

  // OCR의 절 이벤트를 앱 본문 좌표로 한 번에 옮긴 뒤 장별로 나눠 담는다
  const buckets = new Map()
  for (const event of stream.events) {
    if (event.type !== 'verse') continue
    const hit = locate(anchors, index, event.at)
    if (!hit) continue
    let lo = 0
    let hi = spans.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (spans[mid][1] <= hit.at) lo = mid + 1
      else hi = mid
    }
    const [start, end] = spans[lo]
    if (hit.at < start || hit.at >= end) continue
    if (!buckets.has(lo)) buckets.set(lo, [])
    buckets.get(lo).push({ value: event.value, at: hit.at - start, exact: hit.exact, page: event.page })
  }

  const results = []
  for (const [position, row] of books.entries()) {
    if (!isTarget(row)) continue

    // 이미 절 마커가 박힌 장은 건드리지 않는다 — 겹쳐 넣으면 같은 번호가 두 번 나온다
    if (/\(\d{1,3}(?:[-~]\d{1,3})?\)/.test(row.text)) {
      results.push({
        book: row.book,
        book_order: row.book_order,
        chapter: row.chapter,
        pdf,
        status: 'skipped',
        reason: 'already-marked',
      })
      continue
    }

    const part = parts[position]
    const events = buckets.get(position) ?? []
    const ceiling = ceilings.get(`${row.book_order}:${row.chapter}`)
    const picked = pickMarks(events, ceiling)

    const ranges = headingRanges(row.text)
    const marks = []
    for (const mark of picked) {
      const mapped = part.map[mark.at]
      if (mapped === undefined) continue
      const at = pushOutOfHeading(row.text, snapToWord(row.text, mapped), ranges)
      if (marks.length > 0 && at <= marks[marks.length - 1].at) continue
      marks.push({ value: mark.value, at, exact: mark.exact })
    }

    const base = {
      book: row.book,
      book_order: row.book_order,
      chapter: row.chapter,
      pdf,
      coverage: Number(coverage.toFixed(3)),
      candidates: events.length,
      marks: marks.length,
      exact: marks.filter((mark) => mark.exact).length,
      ceiling: ceiling ?? null,
      lastVerse: marks.length ? Number(marks[marks.length - 1].value.split('-').pop()) : 0,
    }

    if (marks.length === 0) {
      results.push({ ...base, status: 'skipped', reason: 'no-marks' })
      continue
    }

    const restored = restoreChapter(row.text, marks)
    if (normalize(restored.text).text !== part.text) {
      results.push({ ...base, status: 'skipped', reason: 'text-changed' })
      continue
    }

    results.push({ ...base, status: 'restored', heading: restored.heading, text: restored.text })
  }

  return results
}

async function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const all = argv.includes('--all')
  const bookArg = argv.includes('--book') ? Number(argv[argv.indexOf('--book') + 1]) : null
  const previewArg = argv.includes('--preview') ? Number(argv[argv.indexOf('--preview') + 1]) : null
  if (!all && !bookArg) {
    console.error('사용법: --book <book_order> | --all [--write] [--preview <chapter>]')
    process.exit(1)
  }

  const rows = await readJsonl(CHAPTERS_PATH)
  const ceilings = verseCeilings(await readJsonl(GAE_PATH))
  const isTarget = (row) =>
    row.book_order <= 39 &&
    row.source_quality !== 'verified' &&
    (all || row.book_order === bookArg)

  const results = []
  for (const [pdf, from, to] of PDF_BOOKS) {
    if (to > 39) continue
    if (bookArg && (bookArg < from || bookArg > to)) continue
    if (!rows.some((row) => isTarget(row) && row.book_order >= from && row.book_order <= to)) continue
    results.push(...(await restorePdf(pdf, from, to, rows, ceilings, isTarget)))
  }

  const restored = results.filter((result) => result.status === 'restored')
  const skipped = results.filter((result) => result.status === 'skipped')
  console.log(`대상 ${results.length}장 → 복원 ${restored.length} / 보류 ${skipped.length}`)
  if (restored.length > 0) {
    const marks = restored.reduce((sum, result) => sum + result.marks, 0)
    const exact = restored.reduce((sum, result) => sum + result.exact, 0)
    const heads = restored.filter((result) => result.heading).length
    console.log(`절 마커 ${marks}개 (정확 정렬 ${((exact / marks) * 100).toFixed(1)}%), 소제목 ${heads}개`)
  }
  for (const reason of new Set(skipped.map((result) => result.reason))) {
    console.log(`  보류(${reason}): ${skipped.filter((result) => result.reason === reason).length}장`)
  }

  if (previewArg) {
    const hit = restored.find((result) => result.chapter === previewArg)
    if (hit) {
      console.log(`\n----- ${hit.book} ${hit.chapter}장 미리보기 -----`)
      console.log(hit.text.split('\n').slice(0, 8).join('\n'))
    }
  }

  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify(
      results.map(({ text, ...rest }) => rest),
      null,
      2,
    )}\n`,
  )
  console.log(`\n리포트: ${REPORT_PATH}`)

  if (!write) return

  const byKey = new Map(restored.map((result) => [`${result.book_order}:${result.chapter}`, result]))
  const lines = rows.map((row) => {
    const hit = byKey.get(`${row.book_order}:${row.chapter}`)
    // structure 필드는 데이터 전용 표식이다 — 앱 산출물(build_public_bible_from_jsonl.mjs)은 읽지 않는다
    return JSON.stringify(hit ? { ...row, text: hit.text, structure: 'restored' } : row)
  })
  await writeFile(CHAPTERS_PATH, `${lines.join('\n')}\n`)
  console.log(`${CHAPTERS_PATH} 갱신: ${restored.length}장`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
