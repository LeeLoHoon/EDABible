// SPL 바인더 원본(회차별 권)을 주제별 세트로 재조합한다.
// 회차 권은 표지·목차(1~6쪽)를 빼고 각 섹션만 이어 붙이며, 00-01의 성경묵상 이전은
// 새신자용으로 따로 뺀다. 섹션 시작 쪽은 각 PDF의 텍스트에서 실측해 확인한 값이다.
//
//   node scripts/build_binder_sets.mjs                        원본 유지
//   node scripts/build_binder_sets.mjs --replace --i-know     원본 PDF 삭제까지
//
// Ghostscript가 있으면 150dpi로 재압축한다(텍스트 레이어는 보존된다).

import { PDFDocument } from 'pdf-lib'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, 'public/binder')
const SOURCE_CACHE_DIR = resolve(ROOT, '.tmp/binder-src-compressed')

const FIRST = { issue: '00-01', file: 'spl-binder-00-01.pdf', meditation: 113, timothy: 151, bookStudy: 163 }
const ISSUES = ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']
const SECTION = { meditation: 7, timothy: 43, bookStudy: 55 }

// 섹션의 끝 쪽 — 다음 섹션 직전까지다. 마지막 섹션(책공부)만 null로 두어 권 끝까지 간다.
// 이 상한을 빼먹으면 앞 섹션이 뒤 섹션까지 삼켜 세트끼리 같은 지면이 중복된다.
const SECTION_END = { meditation: SECTION.timothy - 1, timothy: SECTION.bookStudy - 1, bookStudy: null }
const FIRST_END = { meditation: FIRST.timothy - 1, timothy: FIRST.bookStudy - 1, bookStudy: null }

const zeroBased = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
const mb = (file) => statSync(file).size / 1024 / 1024

function hasGhostscript() {
  try {
    execFileSync('gs', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** 스캔 이미지가 용량 대부분이라 재압축만으로 크게 줄어든다.
    스캔본은 압축이 몇 분씩 걸려 타임아웃을 둔다. 넘기면 압축을 포기하고 넘어간다. */
const COMPRESS_TIMEOUT_MS = 15 * 60 * 1000

const GHOSTSCRIPT_AVAILABLE = hasGhostscript()
const sourcePaths = new Map()

// 원본 권을 먼저 /ebook으로 압축해 두면 pdf-lib 병합본이 이미 작고, 병합 후 gs 실패 영향도 줄어든다.
// 같은 실행에서 실패한 권은 다시 시도하지 않으며, 다음 실행부터는 성공한 캐시를 그대로 재사용한다.
function sourcePath(file) {
  if (sourcePaths.has(file)) return sourcePaths.get(file)

  const original = resolve(DIR, file)
  if (!GHOSTSCRIPT_AVAILABLE) {
    sourcePaths.set(file, original)
    return original
  }

  mkdirSync(SOURCE_CACHE_DIR, { recursive: true })
  const cached = resolve(SOURCE_CACHE_DIR, file)
  if (existsSync(cached)) {
    sourcePaths.set(file, cached)
    return cached
  }

  const tmp = `${cached}.tmp`
  if (existsSync(tmp)) rmSync(tmp)
  try {
    execFileSync('gs', [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook',
      '-dFastWebView=true',
      '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${tmp}`, original,
    ], { stdio: 'ignore', timeout: COMPRESS_TIMEOUT_MS })
    if (statSync(tmp).size < statSync(original).size) {
      renameSync(tmp, cached)
      sourcePaths.set(file, cached)
      console.log(`원본 캐시 ${file.padEnd(24)} ${mb(original).toFixed(1)} → ${mb(cached).toFixed(1)} MB`)
      return cached
    }
  } catch {
    // 이 권만 원본을 사용해 전체 세트 생성을 계속한다.
  }
  if (existsSync(tmp)) rmSync(tmp)
  sourcePaths.set(file, original)
  console.log(`원본 캐시 ${file.padEnd(24)} (압축 실패, 원본 사용)`)
  return original
}

/** 이 원본이 압축 캐시본인지 — 병합 후 재압축 여부를 정하는 데 쓴다. */
function isCompressedSource(file) {
  return sourcePath(file).startsWith(SOURCE_CACHE_DIR)
}

const load = (file) => PDFDocument.load(readFileSync(sourcePath(file)))

// 150dpi(/ebook)를 먼저 쓰고, 죽거나 안 줄면 72dpi(/screen)로 한 번 더 시도한다.
// gs 10.02는 일부 병합본에서 segfault를 내는데 preset을 낮추면 통과하는 경우가 있다.
const PRESETS = ['/ebook', '/screen']

function compress(file) {
  const tmp = `${file}.tmp`
  for (const preset of PRESETS) {
    try {
      execFileSync('gs', [
        '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${preset}`,
        // 선형화하면 pdf.js가 첫 쪽을 앞부분만 받고도 그릴 수 있다
        '-dFastWebView=true',
        '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${tmp}`, file,
      ], { stdio: 'ignore', timeout: COMPRESS_TIMEOUT_MS })
      if (statSync(tmp).size < statSync(file).size) {
        rmSync(file)
        renameSync(tmp, file)
        return preset
      }
    } catch {
      // 다음 preset으로 넘어간다
    }
    if (existsSync(tmp)) rmSync(tmp)
  }
  return null
}

async function buildSet({ id, parts }) {
  const out = await PDFDocument.create()
  const checkpoints = []
  // 압축 캐시에서 온 원본은 이미 gs를 한 번 통과했다. 이런 쪽이 병합 뒤 또 압축되면
  // gs를 두 번 거치면서 한글 ToUnicode CMap이 깨진다(글리프는 멀쩡한데 텍스트
  // 추출·검색만 깨진다). 세트 안에 압축본이 한 쪽이라도 섞이면 그 쪽이 두 번 걸리므로,
  // 병합 후 압축은 **모든 원본이 압축 전**일 때만 한다. 일부만 압축된 세트는
  // 조금 커지더라도 텍스트 레이어를 지키는 쪽을 택한다.
  let anyCompressedSource = false
  for (const { file, from, to, issue } of parts) {
    if (isCompressedSource(file)) anyCompressedSource = true
    const src = await load(file)
    const last = to ?? src.getPageCount()
    if (issue) checkpoints.push({ id: `issue-${issue}`, issue, page: out.getPageCount() + 1 })
    const pages = await out.copyPages(src, zeroBased(from, last))
    pages.forEach((p) => out.addPage(p))
  }
  const file = resolve(DIR, `${id}.pdf`)
  writeFileSync(file, await out.save())
  const before = mb(file)
  const preset = GHOSTSCRIPT_AVAILABLE && !anyCompressedSource ? compress(file) : null
  console.log(
    `${id.padEnd(22)} ${String(out.getPageCount()).padStart(4)}쪽  ` +
      `${before.toFixed(1)} → ${mb(file).toFixed(1)} MB  ${preset ?? '(압축 생략)'}`,
  )
  return { id, pages: out.getPageCount(), checkpoints }
}

const sets = []

// 한글 — 새신자용은 00-01의 성경묵상 직전까지
sets.push(await buildSet({ id: 'spl-starter', parts: [{ file: FIRST.file, from: 1, to: FIRST.meditation - 1 }] }))

for (const [key, id] of [
  ['meditation', 'spl-meditation'],
  ['timothy', 'spl-timothy'],
  ['bookStudy', 'spl-bookstudy'],
]) {
  const parts = [{ file: FIRST.file, from: FIRST[key], to: FIRST_END[key], issue: FIRST.issue }]
  for (const issue of ISSUES) {
    parts.push({ file: `spl-binder-${issue}.pdf`, from: SECTION[key], to: SECTION_END[key], issue })
  }
  sets.push(await buildSet({ id, parts }))
}

// 영문 — 00-01 영문판이 없어 새신자용은 만들지 않는다
for (const [key, id] of [['meditation', 'spl-meditation-en'], ['timothy', 'spl-timothy-en'], ['bookStudy', 'spl-bookstudy-en']]) {
  const parts = ISSUES.map((issue) => ({
    file: `spl-binder-${issue}-en.pdf`,
    from: SECTION[key],
    to: SECTION_END[key],
    issue,
  }))
  sets.push(await buildSet({ id, parts }))
}

const generated = `// 이 파일은 scripts/build_binder_sets.mjs가 생성한다. 직접 고치지 말 것.
// 세트 PDF의 실제 쪽 구성과 어긋나지 않도록 재조합 시 함께 갱신된다.

export interface BinderSetCheckpoint {
  id: string
  issue: string
  page: number
}

export interface BinderSetMeta {
  id: string
  pages: number
  checkpoints: BinderSetCheckpoint[]
}

export const binderSets: BinderSetMeta[] = ${JSON.stringify(sets, null, 2)}
`
writeFileSync(resolve(ROOT, 'src/binderSets.ts'), generated)

// 마이그레이션 스크립트(.mjs)는 .ts를 읽을 수 없어 같은 값을 JSON으로도 남긴다.
// 한 곳에서 같이 쓰므로 둘이 어긋날 수 없다.
writeFileSync(resolve(ROOT, 'scripts/binder-sets.json'), `${JSON.stringify(sets, null, 2)}\n`)
console.log('\nsrc/binderSets.ts · scripts/binder-sets.json 생성 완료')

if (process.argv.includes('--replace')) {
  // 재조합 결과를 검증하기 전에 원본을 지우면 되돌릴 수 없다. 확인 플래그를 하나 더 요구한다.
  if (!process.argv.includes('--i-know')) {
    console.error('--replace는 --i-know와 함께 써야 한다. 세트 PDF를 먼저 검증할 것.')
    process.exit(1)
  }
  const originals = [FIRST.file, ...ISSUES.map((i) => `spl-binder-${i}.pdf`), ...ISSUES.map((i) => `spl-binder-${i}-en.pdf`)]
  let removed = 0
  for (const f of originals) {
    const p = resolve(DIR, f)
    if (existsSync(p)) rmSync(p), (removed += 1)
  }
  console.log(`원본 PDF ${removed}개 삭제`)
}
