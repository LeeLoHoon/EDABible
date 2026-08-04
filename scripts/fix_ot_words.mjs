// 구약 메시지성경의 붙어버린 어절과 망가진 고유명사를 바로잡는다.
//
// 스캔 OCR을 거치며 두 가지가 무너졌다.
//   1) 띄어쓰기: '학개가스알디엘의'처럼 여러 어절이 한 덩어리로 붙었다.
//   2) 고유명사: '스가라'(스가랴), '무비보셋'(므비보셋)처럼 글자가 틀어졌다.
//
// 둘 다 밖에서 답을 가져올 수 있다. 띄어쓰기는 개역개정·새번역·메시지 신약에서 모은 어절
// 사전으로 다시 쪼개면 되고, 고유명사는 같은 장의 개역개정·새번역이 정답을 갖고 있다.
// 지어내는 글자는 없다 — 공백을 넣거나, 같은 장에 실제로 있는 이름으로 바꿀 뿐이다.
//
// 사용법:
//   node scripts/fix_ot_words.mjs                 # 후보만 뽑아 리포트
//   node scripts/fix_ot_words.mjs --write         # 반영
//   node scripts/fix_ot_words.mjs --books 11,12   # 특정 책만
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const GAE_PATH = 'data/bible-chapters.gae.jsonl'
const SAE_PATH = 'data/bible-chapters.sae.jsonl'
const REPORT_PATH = '.tmp/ot-words-report.json'

/** 말라기는 사용자가 제외를 지시했다 */
const EXCLUDED_BOOKS = new Set([39])

/** 분절 조각의 최소 길이 — 한 글자 조각까지 허용하면 아무 말이나 쪼개진다 */
const MIN_PIECE = 2
/** 분절 조각의 최대 길이 */
const MAX_PIECE = 8
/** 쪼갤 때마다 매기는 벌점. 낮으면 과하게 쪼갠다 */
const SPLIT_PENALTY = 7
/** 조각으로 인정할 최소 등장 횟수. 낮으면 멀쩡한 합성어까지 쪼갠다 */
const MIN_PIECE_FREQ = 20
/* 고유명사 교정은 기본으로 끈다. 같은 장에 편집 거리 1인 낱말이 우연히 있으면
   '짝은 → 금은'처럼 뜻을 바꿔 버린다. 표본 정확도가 56%에 그쳐 본문에 쓸 수 없다.
   이 교정은 영어 메시지 성경을 나란히 놓고 문맥을 읽어야 안전하다. */
const FIX_NAMES = process.argv.includes('--names')

/** 이 길이 미만은 붙어버린 덩어리로 보지 않는다 */
const MIN_GLUED = 7

export async function readJsonl(path) {
  const raw = await readFile(path, 'utf8')
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
}

const stripMarkup = (text) => text.replace(/\[\[|\]\]|\((?:\d{1,3})(?:[-~]\d{1,3})?\)/g, ' ')

export function tokenize(text) {
  return stripMarkup(text)
    .split(/\s+/)
    .map((word) => word.replace(/^[^가-힣]+|[^가-힣]+$/g, ''))
    .filter((word) => word.length >= 2)
}

/** 어절 빈도 사전. 메시지 구약 자신은 넣지 않는다 — 오류가 사전에 들어가면 안 된다 */
export function buildCorpus(rows) {
  const corpus = new Map()
  for (const row of rows) {
    for (const word of tokenize(row.text)) corpus.set(word, (corpus.get(word) ?? 0) + 1)
  }
  return corpus
}

/**
 * 붙어버린 어절을 사전에 있는 조각들로 다시 쪼갠다.
 * 조각 빈도의 로그합에서 분절 벌점을 뺀 값이 가장 큰 쪼개기를 고른다.
 */
export function segment(token, corpus) {
  const length = token.length
  const best = new Array(length + 1).fill(-Infinity)
  const from = new Array(length + 1).fill(-1)
  best[0] = 0

  for (let end = MIN_PIECE; end <= length; end += 1) {
    for (let start = Math.max(0, end - MAX_PIECE); start <= end - MIN_PIECE; start += 1) {
      if (best[start] === -Infinity) continue
      const frequency = corpus.get(token.slice(start, end)) ?? 0
      if (frequency < MIN_PIECE_FREQ) continue
      const score = best[start] + Math.log(frequency) - SPLIT_PENALTY
      if (score > best[end]) {
        best[end] = score
        from[end] = start
      }
    }
  }
  if (best[length] === -Infinity) return null

  const pieces = []
  for (let end = length; end > 0; end = from[end]) pieces.push(token.slice(from[end], end))
  return pieces.reverse()
}

/** 두 낱말의 편집 거리 (최대 limit까지만 센다) */
export function distance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

/** 시스템 한국어 사전 — 여기에 있으면 일반 낱말이지 인명·지명이 아니다 */
const KO_DICT_PATH = process.env.KO_DICT_PATH ?? '/usr/share/hunspell/ko.dic'

export async function loadKoreanDictionary(path = KO_DICT_PATH) {
  try {
    const raw = await readFile(path, 'utf8')
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

/** 조사·어미가 붙은 어절도 어간으로 알아본다 */
export function knownKorean(word, dictionary) {
  if (!dictionary) return false
  if (dictionary.has(word)) return true
  for (let length = word.length - 1; length >= 2; length -= 1) {
    if (word.length - length > 3) break
    if (dictionary.has(word.slice(0, length))) return true
  }
  return false
}

/** 온 성경에서 드물게 나오는 어절 = 인명·지명. 흔한 말은 이름이 아니다 */
export function rareWords(corpus, max = 40) {
  const rare = new Set()
  for (const [word, count] of corpus) if (count <= max) rare.add(word)
  return rare
}

async function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const only = argv.includes('--books')
    ? new Set(argv[argv.indexOf('--books') + 1].split(',').map(Number))
    : null

  const rows = await readJsonl(CHAPTERS_PATH)
  const gae = await readJsonl(GAE_PATH)
  const sae = await readJsonl(SAE_PATH)

  const corpus = buildCorpus([...gae, ...sae, ...rows.filter((row) => row.book_order >= 40)])
  const messageWords = buildCorpus(rows)
  const korean = await loadKoreanDictionary()
  if (!korean) console.warn('한국어 사전을 찾지 못했다 — 고유명사 교정을 건너뛴다')
  const rare = rareWords(corpus)

  // 어절이 몇 개 장에 걸쳐 나오는지 — 되풀이되면 인명·지명, 한 장뿐이면 그 장의 낱말
  const nameChapters = new Map()
  for (const row of [...gae, ...sae]) {
    for (const word of new Set(tokenize(row.text))) {
      nameChapters.set(word, (nameChapters.get(word) ?? 0) + 1)
    }
  }

  // 장별 대조 어절 — 같은 장의 개역개정·새번역에 실제로 있는 말들
  const perChapter = new Map()
  const seen = new Map()
  for (const [source, list] of [['gae', gae], ['sae', sae]]) {
    for (const row of list) {
      const key = `${row.book_order}:${row.chapter}`
      const map = seen.get(key) ?? new Map()
      for (const word of tokenize(row.text)) if (rare.has(word)) map.set(word, (map.get(word) ?? new Set()).add?.(source) ?? new Set([source]))
      seen.set(key, map)
    }
  }
  for (const [key, map] of seen) {
    const set = new Set()
    for (const [word, sources] of map) if (sources.size === 2) set.add(word)
    perChapter.set(key, set)
  }

  const fixes = []
  const updated = rows.map((row) => {
    if (row.book_order > 39 || EXCLUDED_BOOKS.has(row.book_order)) return row
    if (only && !only.has(row.book_order)) return row

    const names = perChapter.get(`${row.book_order}:${row.chapter}`) ?? new Set()
    let changed = false

    const text = row.text.replace(/[가-힣]{2,}/g, (token) => {
      if (corpus.has(token)) return token

      // 메시지성경 어디에든 다시 나오는 말이면 OCR 사고가 아니라 실제로 쓰는 말이다
      if ((messageWords.get(token) ?? 0) > 1) return token

      // 1) 붙어버린 어절 다시 띄우기
      if (token.length >= MIN_GLUED) {
        const pieces = segment(token, corpus)
        if (pieces && pieces.length >= 2) {
          changed = true
          fixes.push({ book: row.book, chapter: row.chapter, kind: 'spacing', from: token, to: pieces.join(' ') })
          return pieces.join(' ')
        }
      }

      if (!FIX_NAMES) return token

      // 2) 같은 장의 대조 본문에 있는 이름으로 바로잡기.
      //    끝 글자만 다른 것은 조사 차이(학개를/학개가)이므로 건드리지 않는다.
      for (const name of names) {
        if (name.length !== token.length || distance(name, token) !== 1) continue
        // 국어사전에 있는 말은 인명·지명이 아니다 (나귀들 → 나라들 같은 오교정을 막는다)
        if (!korean || knownKorean(name, korean) || knownKorean(token, korean)) continue
        // 성경 이름은 여러 장에 되풀이해서 나온다. 한 장에만 있는 말은 이름이 아닐 공산이 크다
        if ((nameChapters.get(name) ?? 0) < 3) continue
        let at = 0
        while (at < token.length && token[at] === name[at]) at += 1
        if (at >= token.length - 1) continue
        changed = true
        fixes.push({ book: row.book, chapter: row.chapter, kind: 'name', from: token, to: name })
        return name
      }

      return token
    })

    return changed ? { ...row, text } : row
  })

  const spacing = fixes.filter((fix) => fix.kind === 'spacing').length
  const names = fixes.filter((fix) => fix.kind === 'name').length
  console.log(`고칠 곳 ${fixes.length}건 — 띄어쓰기 ${spacing}, 고유명사 ${names}`)

  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(fixes, null, 2)}\n`)
  console.log(`리포트: ${REPORT_PATH}`)
  for (const fix of fixes.filter((f) => f.kind === 'spacing').slice(0, 6)) {
    console.log(`  띄어쓰기 ${fix.book}${fix.chapter}: ${fix.from} → ${fix.to}`)
  }
  for (const fix of fixes.filter((f) => f.kind === 'name').slice(0, 6)) {
    console.log(`  고유명사 ${fix.book}${fix.chapter}: ${fix.from} → ${fix.to}`)
  }

  if (!write) return
  await writeFile(CHAPTERS_PATH, `${updated.map((row) => JSON.stringify(row)).join('\n')}\n`)
  console.log(`${CHAPTERS_PATH} 갱신`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
