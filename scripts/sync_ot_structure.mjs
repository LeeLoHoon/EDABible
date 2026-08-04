// 구조를 복원한 구약 장만 Supabase에 올리고, 언제든 되돌릴 수 있게 백업을 남긴다.
//
// 앱은 ko+msg일 때 Supabase의 bible_chapters를 로컬 JSON보다 먼저 읽는다. 그래서 배포만으로는
// 화면이 바뀌지 않고 원격을 갱신해야 한다. 다만 전체 upsert(seed:supabase-bible)는 사용자가
// 완료 처리한 장의 is_finalized까지 지우므로 쓰면 안 된다.
//
// 이 스크립트는
//   - 손댈 장의 원격 상태를 통째로 백업하고
//   - structure:"restored" 표식이 붙은 장만, 그것도 완료 처리되지 않은 것만 올리며
//   - 백업 파일로 원상 복구할 수 있다.
//
// 사용법:
//   node scripts/sync_ot_structure.mjs --backup <파일>   # 원격 상태 저장
//   node scripts/sync_ot_structure.mjs --push <파일>     # 백업을 만든 뒤 올리기
//   node scripts/sync_ot_structure.mjs --restore <파일>  # 백업으로 되돌리기
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const CHAPTERS_PATH = 'data/bible-chapters.jsonl'
const CHUNK = 100

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

async function readJsonl(path) {
  const raw = await readFile(path, 'utf8')
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line))
}

const hangul = (text) => text.replace(/[^가-힣]/g, '')

function client() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL과 키가 필요하다')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** 원격 bible_chapters 전체를 가져온다 (10권씩 나눠 받는다) */
async function fetchRemote(supabase) {
  const rows = []
  for (let from = 1; from <= 66; from += 10) {
    const { data, error } = await supabase
      .from('bible_chapters')
      .select('book_order, book, abbr, file, chapter, text, is_finalized, source_build')
      .gte('book_order', from)
      .lt('book_order', from + 10)
    if (error) throw error
    rows.push(...data)
  }
  return rows
}

async function upsert(supabase, rows, label) {
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK)
    const { error } = await supabase
      .from('bible_chapters')
      .upsert(chunk, { onConflict: 'book_order,chapter' })
    if (error) throw error
    process.stdout.write(`${label} ${Math.min(offset + chunk.length, rows.length)}/${rows.length}\n`)
  }
}

async function main() {
  await loadEnv()
  const argv = process.argv.slice(2)
  const mode = argv.find((item) => item.startsWith('--'))?.slice(2)
  const path = argv[argv.indexOf(`--${mode}`) + 1]
  if (!['backup', 'push', 'restore'].includes(mode) || !path) {
    console.error('사용법: --backup <파일> | --push <파일> | --restore <파일>')
    process.exit(1)
  }

  const supabase = client()

  if (mode === 'restore') {
    const backup = JSON.parse(await readFile(path, 'utf8'))
    console.log(`백업 ${backup.rows.length}장을 원격에 되돌린다 (백업 시각 ${backup.savedAt})`)
    await upsert(supabase, backup.rows, '복구')
    console.log('되돌리기 완료')
    return
  }

  const remote = await fetchRemote(supabase)
  const backup = { savedAt: new Date().toISOString(), rows: remote }
  await writeFile(path, `${JSON.stringify(backup, null, 2)}\n`)
  console.log(`원격 ${remote.length}장 백업: ${path}`)
  if (mode === 'backup') return

  const byKey = new Map(remote.map((row) => [`${row.book_order}:${row.chapter}`, row]))
  const local = await readJsonl(CHAPTERS_PATH)
  // structure: 구조만 얹은 장 / rebuilt: 원본 스캔에서 본문째 다시 만든 장
  const targets = local.filter((row) => row.structure === 'restored' || row.source_quality === 'rebuilt')

  const payload = []
  let finalized = 0
  let diverged = 0
  for (const row of targets) {
    const hit = byKey.get(`${row.book_order}:${row.chapter}`)
    if (!hit) continue
    if (hit.is_finalized) {
      finalized += 1
      continue // 사용자가 완료 처리한 장은 건드리지 않는다
    }
    // 구조 복원은 한글을 하나도 바꾸지 않으므로, 원격 한글이 다르면 웹에서 손댄 장이라 건너뛴다.
    // 재구축(rebuilt) 장은 본문 자체를 새로 만든 것이라 이 비교가 성립하지 않는다.
    if (row.source_quality !== 'rebuilt' && hangul(hit.text) !== hangul(row.text)) {
      diverged += 1
      continue
    }
    payload.push({
      book_order: row.book_order,
      book: row.book,
      abbr: row.abbr,
      file: row.file,
      chapter: row.chapter,
      text: row.text,
      source_build: process.env.npm_package_version ?? 'structure-restore',
    })
  }

  console.log(
    `복원 대상 ${targets.length}장 중 올릴 것 ${payload.length}장 ` +
      `(완료 처리되어 건너뜀 ${finalized}, 원격이 달라 건너뜀 ${diverged})`,
  )
  await upsert(supabase, payload, '올림')
  console.log('반영 완료. 되돌리려면: node scripts/sync_ot_structure.mjs --restore ' + path)
}

await main()
