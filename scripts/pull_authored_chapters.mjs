// 사용자가 앱에서 직접 쓴 장의 본문을 원격에서 그대로 내려받아 로컬 jsonl에 덮는다.
//
// 대상은 두 가지다.
//   - 완료 처리한 장(is_finalized) — 정본이다
//   - 완료 처리는 안 했지만 앱에서 고친 장(bible_chapter_edits에 이력이 있는 장)
//
// 앱 편집은 Supabase bible_chapters에만 저장되고 로컬 jsonl로는 내려오지 않는다. 그래서 로컬 사본은
// 사용자 원고와 계속 벌어지고, 구약 일괄 스크립트(restore_ot_structure / fix_ot_by_scans)는 그
// 벌어진 사본을 대상으로 돌아 확정 장까지 건드렸다. 이 스크립트는 반대 방향으로 맞춘다 — 원격이 정본이다.
//
// 전체를 덮는 pull:supabase-bible과 달리 사용자가 쓴 장만 손대고, source_quality 같은 나머지 필드는
// 둔다. 완료 처리된 장에는 jsonl에도 is_finalized 표식을 남겨, 앞으로 일괄 스크립트가 건너뛸 수 있게 한다.
//
// 사용법:
//   node scripts/pull_authored_chapters.mjs            # 무엇이 바뀌는지만 보여준다
//   node scripts/pull_authored_chapters.mjs --write    # 실제로 반영
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const PAGE = 1000

async function loadEnv(path = '.env.local') {
  try {
    const text = await readFile(path, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const at = line.indexOf('=')
      if (at < 1) continue
      process.env[line.slice(0, at).trim()] ??= line
        .slice(at + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // .env.local이 없으면 환경변수만 쓴다
  }
}

function client() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL과 키가 필요하다')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** 앱에서 고친 적이 있는 장의 키 (완료 처리 여부와 무관하다) */
async function fetchEditedKeys(supabase) {
  const keys = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bible_chapter_edits')
      .select('book_order, chapter')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data) keys.add(`${row.book_order}:${row.chapter}`)
    if (data.length < PAGE) break
  }
  return keys
}

/** 원격 bible_chapters 전체를 가져온다 (10권씩 나눠 받는다) */
async function fetchRemote(supabase) {
  const rows = []
  for (let from = 1; from <= 66; from += 10) {
    const { data, error } = await supabase
      .from('bible_chapters')
      .select('book_order, book, chapter, text, is_finalized')
      .gte('book_order', from)
      .lt('book_order', from + 10)
    if (error) throw error
    rows.push(...data)
  }
  return rows
}

await loadEnv()

const write = process.argv.includes('--write')
const supabase = client()
const editedKeys = await fetchEditedKeys(supabase)
const remote = await fetchRemote(supabase)

const authored = remote.filter(
  (row) => row.is_finalized === true || editedKeys.has(`${row.book_order}:${row.chapter}`),
)
const byKey = new Map(authored.map((row) => [`${row.book_order}:${row.chapter}`, row]))

const raw = await readFile(CHAPTERS_PATH, 'utf8')
const lines = raw.split(/\r?\n/).filter((line) => line.trim())
const changedByBook = new Map()
let changed = 0
let alreadySame = 0

const next = lines.map((line) => {
  const row = JSON.parse(line)
  const key = `${row.book_order}:${row.chapter}`
  const hit = byKey.get(key)
  if (!hit) return line
  byKey.delete(key)

  const wantsFlag = hit.is_finalized === true
  if (row.text === hit.text && !!row.is_finalized === wantsFlag) {
    alreadySame += 1
    return line
  }

  if (row.text !== hit.text) {
    changed += 1
    changedByBook.set(row.book, (changedByBook.get(row.book) ?? 0) + 1)
    // 본문이 사용자 원고로 바뀌므로 구조 복원 산출물이라는 표식은 더 이상 맞지 않는다
    delete row.structure
  }
  row.text = hit.text
  if (wantsFlag) row.is_finalized = true
  else delete row.is_finalized
  return JSON.stringify(row)
})

const finalizedCount = authored.filter((row) => row.is_finalized).length
console.log(`사용자가 쓴 장 ${authored.length}장 (완료 처리 ${finalizedCount}, 편집만 ${authored.length - finalizedCount})`)
console.log(`  로컬 본문을 원고로 되돌림: ${changed}장`)
console.log(`    ${[...changedByBook].map(([book, n]) => `${book} ${n}`).join(', ') || '없음'}`)
console.log(`  이미 같음: ${alreadySame}장`)
if (byKey.size > 0) console.log(`  로컬 jsonl에 없는 장: ${byKey.size}장`, [...byKey.keys()].join(', '))

if (!write) {
  console.log('\n--write 를 붙이면 실제로 반영한다.')
} else {
  await writeFile(CHAPTERS_PATH, next.join('\n') + '\n')
  console.log(`\n${CHAPTERS_PATH} 반영 완료. npm run build:bible 로 public/bible을 다시 만들 것.`)
}
