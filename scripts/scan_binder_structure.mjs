// SPL 바인더 세트 PDF에서 화면용 구조 메타데이터를 실측한다. PDF는 원본 자료이므로
// 읽기만 하고 수정하지 않는다.
//
//   node scripts/scan_binder_structure.mjs            # 실측 결과만 출력
//   node scripts/scan_binder_structure.mjs --write    # 데이터 파일까지 생성
//
// 산출물
//   scripts/binder_checkpoints.mjs    세트별 체크포인트
//                                     성경묵상 = 3쪽 "성경묵상 순서"의 성경 단위
//                                     디모데   = "디모데 만들기 순서"의 대제목 단위
//                                     책공부   = "책공부 순서"의 책 단위
//   scripts/binder_text_presets.mjs   쪽 유형별 기본 텍스트 상자 배치
//
// 쪽 레이아웃(불릿·밑줄·괘선)은 PDF에 그려진 이미지라 텍스트로 읽을 수 없다. 좌표는
// 72dpi 그레이스케일 렌더의 행 프로파일로 실측한 값이며, 성경묵상 필기 쪽과 디모데·
// 책공부 괘선 쪽은 전 쪽이 동일한 레이아웃임을 표본으로 확인했다(README 참조).

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { binderVideos } from './binder_videos.mjs'

/** build_binder_sets.mjs가 만든 실제 세트 구성 (src/binderSets.ts와 같은 값) */
const binderSets = JSON.parse(readFileSync(new URL('./binder-sets.json', import.meta.url), 'utf8'))

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BINDER_DIR = resolve(ROOT, 'public/binder')

const SETS = [
  { id: 'spl-meditation', kind: 'meditation', lang: 'ko' },
  { id: 'spl-timothy', kind: 'timothy', lang: 'ko' },
  { id: 'spl-bookstudy', kind: 'bookStudy', lang: 'ko' },
  { id: 'spl-meditation-en', kind: 'meditation', lang: 'en' },
  { id: 'spl-timothy-en', kind: 'timothy', lang: 'en' },
  { id: 'spl-bookstudy-en', kind: 'bookStudy', lang: 'en' },
]

/** 영어 세트는 00-01호가 빠져 있어 한국어 세트보다 이만큼 앞당겨진다 */
const EN_PAGE_SHIFT = { 'spl-timothy-en': 12, 'spl-bookstudy-en': 10 }

/**
 * 00-01호의 "순서" 쪽은 스캔 이미지라 텍스트 레이어가 없다. 렌더 이미지를 직접 읽어
 * 확인한 값만 손으로 채운다. 그 뒤 호는 모두 자동 실측이다.
 */
const MANUAL_FIRST_ISSUE = {
  'spl-timothy': [
    { no: 1, title: '1. 김기동 목사님 - 고구마 전도왕', lessonNo: 1 },
    { no: 2, title: '2. 이재철 목사님 - 새신자반 + 박효진 장로님 간증', lessonNo: 2 },
  ],
  'spl-bookstudy': [{ title: '구원', page: 1 }],
}

// ── PDF 읽기 ───────────────────────────────────────────────────────────────

/** 텍스트 조각의 x·y는 쪽 대비 비율이고, y는 화면 기준(위=0)의 baseline이다. */
async function readSet(setId) {
  const doc = await getDocument({
    url: new URL(`file://${resolve(BINDER_DIR, `${setId}.pdf`)}`),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise

  const pages = []
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    pages.push(
      content.items
        .filter((item) => typeof item.str === 'string' && item.str.trim())
        .map((item) => ({
          str: item.str.trim(),
          x: item.transform[4] / viewport.width,
          y: 1 - item.transform[5] / viewport.height,
          size: Math.abs(item.transform[3]) / viewport.height,
        })),
    )
  }
  await doc.destroy()
  return pages
}

const pagesOf = (setId) => binderSets.find((set) => set.id === setId)?.pages ?? 0

/** 세트 안에서 그 쪽이 속한 호의 시작 쪽 */
function issueStartPage(setId, pageNumber) {
  const checkpoints = binderSets.find((set) => set.id === setId)?.checkpoints ?? []
  let start = 1
  for (const checkpoint of checkpoints) {
    if (checkpoint.page <= pageNumber) start = checkpoint.page
  }
  return start
}

/** 디모데 영상 번호 → 그 영상이 붙는 쪽 (영어 세트는 00-01호가 없어 앞당겨진다) */
function timothyLessonPage(setId, lessonNo) {
  const lessons = (binderVideos['spl-timothy'] ?? []).flatMap((stage) => stage.lessons)
  const lesson = lessons.find((item) => item.no === lessonNo)
  if (!lesson) return null
  const page = lesson.page - (EN_PAGE_SHIFT[setId] ?? 0)
  return page >= 1 ? page : null
}

// ── 성경묵상: "오늘의 성경묵상" 쪽의 성경 라벨 ──────────────────────────────

/** 예: '잠언 1장' · '잠언 1,2장' · '시편 1편' */
const KO_BOOK_LABEL = /^(?<book>[가-힣]+)\s*(?<chapters>\d[\d,~\-\s]*)\s*(?<unit>장|편)$/
/** 예: 'Proverbs 1' · '1 Samuel 1' · 'Psalm 1' */
const EN_BOOK_LABEL = /^(?<book>[1-3]?\s?[A-Za-z][A-Za-z ]*?)\s+(?<chapters>\d[\d,~\-\s]*)$/

function bookLabelOf(str, lang) {
  const match = (lang === 'en' ? EN_BOOK_LABEL : KO_BOOK_LABEL).exec(str)
  if (!match) return null
  const book = match.groups.book.trim()
  if (!book || book.length > 24) return null
  const chapters = match.groups.chapters.replace(/\s+/g, '')
  // 하루에 2장씩 읽는 구간은 '잠언 1,2장' · 'Proverbs 1-2'처럼 장이 묶여 적힌다
  return {
    book,
    chapters,
    first: /^1(?:$|[,~\-])/.test(chapters),
    stride: /[,~\-]/.test(chapters) ? 2 : 1,
  }
}

/** 성경 라벨은 본문 왼쪽 끝에만 놓인다 — 다른 텍스트와 섞이지 않게 x로 한 번 거른다 */
function meditationLabelsOf(items, lang) {
  return items
    .filter((item) => item.x < 0.2)
    .map((item) => ({ ...item, label: bookLabelOf(item.str, lang) }))
    .filter((item) => item.label)
    .sort((a, b) => a.y - b.y)
}

function scanMeditation(pages, lang) {
  const checkpoints = []
  const writingPages = []
  let previousBooks = null

  pages.forEach((items, index) => {
    const labels = meditationLabelsOf(items, lang)
    if (labels.length === 0) return
    const pageNumber = index + 1
    writingPages.push({ page: pageNumber, blocks: labels.length })

    const books = [...new Set(labels.map((item) => item.label.book))]

    // 첫 필기 쪽은 그 세트가 어디서부터 읽기 시작하는지 그대로 보여준다.
    // (영어 세트는 00-01호가 없어 잠언 17장처럼 중간부터 시작한다)
    if (previousBooks === null) {
      checkpoints.push({ page: pageNumber, books, stride: labels[0].label.stride })
      previousBooks = books
      return
    }

    // 그 뒤로는 "직전 쪽에 없던 성경이 1장(1편)부터 새로 시작하는 쪽"이 순서의 다음 항목이다.
    // 전도서처럼 짧은 책이 같은 구간 안에서 다시 1장으로 돌아오는 경우는 걸러진다.
    const starting = labels.filter((item) => item.label.first && !previousBooks.includes(item.label.book))
    previousBooks = books
    if (starting.length === 0) return
    checkpoints.push({
      page: pageNumber,
      books: [...new Set(starting.map((item) => item.label.book))],
      stride: starting[0].label.stride,
    })
  })

  return { checkpoints, writingPages }
}

// ── 디모데: "디모데 만들기 순서" 쪽의 대제목 ────────────────────────────────

const TIMOTHY_ORDER_TITLE = /^(?:디모데 만들기 순서|Raising a Timothy: Sessions)$/
/** 대제목은 '10. 이재철 목사님 - 사명자반'처럼 번호로 시작하고 본문 왼쪽 끝에 놓인다 */
const NUMBERED_HEADING = /^(?<no>\d+)\.\s+(?<title>\S.*)$/
const HEADING_X_MAX = 0.13

function scanTimothy(setId, pages) {
  const found = new Map()

  pages.forEach((items, index) => {
    if (!items.some((item) => TIMOTHY_ORDER_TITLE.test(item.str))) return

    // 대제목 아래 첫 소항목의 영상 번호가 그 대제목이 시작되는 쪽을 가리킨다
    const headings = items
      .filter((item) => item.x < HEADING_X_MAX && item.y > 0.2 && NUMBERED_HEADING.test(item.str))
      .sort((a, b) => a.y - b.y)
    const lessonNumbers = items
      .filter((item) => item.x > HEADING_X_MAX && item.x < 0.35 && /^\d+$/.test(item.str))
      .sort((a, b) => a.y - b.y)

    for (const [order, heading] of headings.entries()) {
      const no = Number(NUMBERED_HEADING.exec(heading.str).groups.no)
      if (found.has(no)) continue
      const nextHeadingY = headings[order + 1]?.y ?? 1
      const firstLesson = lessonNumbers.find((item) => item.y > heading.y && item.y < nextHeadingY)
      const page = firstLesson
        ? timothyLessonPage(setId, Number(firstLesson.str))
        : issueStartPage(setId, index + 1)
      if (page === null) continue
      found.set(no, { no, title: heading.str, page })
    }
  })

  for (const manual of MANUAL_FIRST_ISSUE[setId] ?? []) {
    if (found.has(manual.no)) continue
    const page = manual.page ?? timothyLessonPage(setId, manual.lessonNo)
    if (page === null) continue
    found.set(manual.no, { no: manual.no, title: manual.title, page })
  }

  return [...found.values()].sort((a, b) => a.page - b.page)
}

// ── 책공부: "책공부 순서" 쪽의 책 이름 ──────────────────────────────────────

const BOOKSTUDY_ORDER_TITLE = /^(?:책공부 순서|Book Study: Sessions)$/

/**
 * 순서 쪽 왼쪽에는 책 이름(여러 줄)과 저자가 세로로 놓인다. 마지막 줄이 저자다.
 * 오른쪽(x ≥ 0.35)은 과 목록이라 제외한다.
 */
function bookStudyTitleOf(items) {
  const left = items
    .filter((item) => item.x < 0.35 && item.y > 0.3)
    .sort((a, b) => a.y - b.y)
  if (left.length < 2) return null
  return left
    .slice(0, -1)
    .map((item) => item.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scanBookStudy(setId, pages) {
  const checkpoints = []
  let previous = null

  for (const manual of MANUAL_FIRST_ISSUE[setId] ?? []) {
    checkpoints.push({ title: manual.title, page: manual.page })
    previous = manual.title
  }

  pages.forEach((items, index) => {
    if (!items.some((item) => BOOKSTUDY_ORDER_TITLE.test(item.str))) return
    const title = bookStudyTitleOf(items)
    if (!title || title === previous) return
    previous = title
    checkpoints.push({ title, page: issueStartPage(setId, index + 1) })
  })

  return checkpoints
}

// ── 괘선 필기 쪽 ───────────────────────────────────────────────────────────

const WRITING_PROMPT = /느낀 점을 적어보아요|Write your reflections on/

/** 제목이 있는 쪽과, 그 뒤에 이어지는 빈 괘선 쪽을 함께 모은다 */
function scanRuledPages(pages) {
  const titled = []
  const plain = []
  pages.forEach((items, index) => {
    const pageNumber = index + 1
    if (items.some((item) => WRITING_PROMPT.test(item.str))) {
      titled.push(pageNumber)
      return
    }
    if (items.length === 0 && titled.at(-1) === pageNumber - 1) plain.push(pageNumber)
  })
  return { titled, plain }
}

// ── 텍스트 상자 프리셋 좌표 (72dpi 렌더 실측) ──────────────────────────────

/** 성경묵상 필기 쪽 — 블록(성경) 2개, 블록마다 묵상 3칸 + 배우자 기도 1칸 */
const MEDITATION_BLOCKS = [
  { bullets: [0.1912, 0.2833, 0.3747], spouseRule: 0.4917 },
  { bullets: [0.6253, 0.7168, 0.8082], spouseRule: 0.9252 },
]
const MEDITATION_BOX = { x: 0.095, width: 0.81, height: 0.086, bulletOffset: 0.019 }
// 배우자 기도는 인쇄된 밑줄 바로 위 한 줄이다 — 앞 묵상 칸과 겹치지 않게 밑줄에 붙인다
const MEDITATION_SPOUSE_BOX = { x: 0.205, width: 0.7, height: 0.0485, ruleOffset: 0.0485 }

function meditationPreset(blockCount) {
  const boxes = []
  MEDITATION_BLOCKS.slice(0, blockCount).forEach((block, blockIndex) => {
    block.bullets.forEach((bullet, bulletIndex) => {
      boxes.push({
        id: `note-${blockIndex + 1}-${bulletIndex + 1}`,
        x: MEDITATION_BOX.x,
        y: Number((bullet - MEDITATION_BOX.bulletOffset).toFixed(4)),
        width: MEDITATION_BOX.width,
        height: MEDITATION_BOX.height,
      })
    })
    boxes.push({
      id: `spouse-${blockIndex + 1}`,
      x: MEDITATION_SPOUSE_BOX.x,
      y: Number((block.spouseRule - MEDITATION_SPOUSE_BOX.ruleOffset).toFixed(4)),
      width: MEDITATION_SPOUSE_BOX.width,
      height: MEDITATION_SPOUSE_BOX.height,
    })
  })
  return boxes
}

/**
 * 괘선 쪽 — 괘선을 덮는 큰 칸 하나 (제목 유무로 시작 높이가 다르다).
 * `opaque`는 타이핑할 때 흰 바탕으로 인쇄된 괘선을 가린다는 뜻이다.
 */
const RULED_PRESETS = {
  titled: [{ id: 'note', x: 0.062, y: 0.135, width: 0.855, height: 0.79, opaque: true }],
  plain: [{ id: 'note', x: 0.088, y: 0.075, width: 0.855, height: 0.845, opaque: true }],
}

// ── 실행 ───────────────────────────────────────────────────────────────────

const shouldWrite = process.argv.includes('--write')
const checkpointData = {}
/** { setId: { layoutId: [쪽 번호…] } } — 같은 배치를 쓰는 쪽이 수백 개라 유형별로 모은다 */
const presetData = {}
const layoutData = {}

function useLayout(id, boxes) {
  layoutData[id] ??= boxes
  return id
}

for (const set of SETS) {
  const pages = await readSet(set.id)
  const pageCount = pagesOf(set.id) || pages.length

  if (set.kind === 'meditation') {
    const { checkpoints, writingPages } = scanMeditation(pages, set.lang)
    checkpointData[set.id] = checkpoints.map((checkpoint, index) => ({
      id: `book-${String(index + 1).padStart(2, '0')}`,
      // 첫 항목은 표지·순서 쪽부터가 그 구간이다
      page: index === 0 ? 1 : checkpoint.page,
      label:
        checkpoint.books.join(' & ') +
        (checkpoint.stride === 2 ? (set.lang === 'en' ? ' (2 ch. each)' : ' (각 2장)') : ''),
    }))
    const byLayout = {}
    for (const { page, blocks } of writingPages) {
      const layoutId = useLayout(`meditation-${blocks}`, meditationPreset(blocks))
      ;(byLayout[layoutId] ??= []).push(page)
    }
    presetData[set.id] = byLayout
  } else {
    const checkpoints =
      set.kind === 'timothy' ? scanTimothy(set.id, pages) : scanBookStudy(set.id, pages)
    checkpointData[set.id] = checkpoints.map((checkpoint, index) => ({
      id: `part-${String(index + 1).padStart(2, '0')}`,
      page: index === 0 ? 1 : checkpoint.page,
      label: checkpoint.title,
    }))
    const ruled = scanRuledPages(pages)
    presetData[set.id] = {
      [useLayout('ruled-titled', RULED_PRESETS.titled)]: ruled.titled,
      [useLayout('ruled-plain', RULED_PRESETS.plain)]: ruled.plain,
    }
  }

  const checkpoints = checkpointData[set.id]
  const presetPages = Object.values(presetData[set.id]).flat().sort((a, b) => a - b)
  console.log(`\n=== ${set.id} (${pageCount}쪽)`)
  console.log(`  체크포인트 ${checkpoints.length}개`)
  for (const checkpoint of checkpoints) {
    console.log(`    p${String(checkpoint.page).padStart(3)}  ${checkpoint.label}`)
  }
  console.log(`  기본 입력칸 쪽 ${presetPages.length}개 (예: ${presetPages.slice(0, 6).join(', ')})`)

  const outOfRange = checkpoints.filter((c) => c.page < 1 || c.page > pageCount)
  if (outOfRange.length > 0) console.log('  ⚠ 쪽 범위를 벗어난 체크포인트', outOfRange)
  const unordered = checkpoints.some((c, i, list) => i > 0 && c.page <= list[i - 1].page)
  if (unordered) console.log('  ⚠ 체크포인트 쪽 순서가 오름차순이 아닙니다')
}

if (!shouldWrite) {
  console.log('\n--write 를 붙이면 scripts/binder_checkpoints.mjs 와 binder_text_presets.mjs 를 만듭니다.')
  process.exit(0)
}

const banner = (what) =>
  `// 이 파일은 scripts/scan_binder_structure.mjs가 생성한다. 직접 고치지 말 것.\n` +
  `// ${what}\n\n`

writeFileSync(
  resolve(ROOT, 'scripts/binder_checkpoints.mjs'),
  `${banner('세트 PDF에서 실측한 체크포인트 — 성경묵상은 성경 단위, 디모데는 순서 대제목, 책공부는 책 단위다.')}` +
    `export const binderCheckpoints = ${JSON.stringify(checkpointData, null, 2)}\n\n` +
    `/** 세트의 실측 체크포인트 — 없으면 호수 label로 폴백한다. */\n` +
    `export function checkpointsFor(setId) {\n  return binderCheckpoints[setId] ?? null\n}\n`,
)

writeFileSync(
  resolve(ROOT, 'scripts/binder_text_presets.mjs'),
  `${banner('쪽에 기본으로 놓이는 텍스트 상자 — 값은 쪽 대비 비율(0~1)이다. 사용자가 입력하기 전에는 저장되지 않는다.')}` +
    `/** 배치 유형 — 같은 배치를 쓰는 쪽이 수백 개라 유형을 한 번만 적는다. */\n` +
    `export const binderTextLayouts = ${JSON.stringify(layoutData, null, 2)}\n\n` +
    `/** 세트별 { 배치 유형: [쪽 번호…] } */\n` +
    `export const binderTextPresetPages = ${JSON.stringify(presetData)}\n\n` +
    `const pageIndex = new Map(\n` +
    `  Object.entries(binderTextPresetPages).map(([setId, byLayout]) => [\n` +
    `    setId,\n` +
    `    new Map(\n` +
    `      Object.entries(byLayout).flatMap(([layoutId, pages]) =>\n` +
    `        pages.map((page) => [page, binderTextLayouts[layoutId]]),\n` +
    `      ),\n` +
    `    ),\n` +
    `  ]),\n` +
    `)\n\n` +
    `const EMPTY = []\n\n` +
    `/** 그 쪽에 기본으로 놓을 텍스트 상자 배치 — 없으면 빈 배열이다. */\n` +
    `export function textPresetsFor(setId, page) {\n` +
    `  return pageIndex.get(setId)?.get(page) ?? EMPTY\n}\n`,
)

console.log('\nscripts/binder_checkpoints.mjs, scripts/binder_text_presets.mjs 를 생성했습니다.')
