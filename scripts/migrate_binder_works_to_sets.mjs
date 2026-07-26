import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { legacyBinderBooks, migrateLegacyWorks } from './binder_legacy_map.mjs'

const APPLY = process.argv.includes('--apply')
const PAGE_SIZE = 1000
const LEGACY_IDS = new Set(legacyBinderBooks.map((book) => book.id))

async function loadLocalEnv(path) {
  try {
    await stat(path)
  } catch {
    return
  }

  const text = await readFile(path, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 1) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    process.env[key] ??= value
  }
}

async function readSets() {
  try {
    return JSON.parse(await readFile(new URL('./binder-sets.json', import.meta.url), 'utf8'))
  } catch {
    throw new Error('scripts/binder-sets.json이 없습니다. 세트 생성 완료 후 다시 실행하세요.')
  }
}

async function readAllRows(supabase) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('binder_works')
      .select('user_id, book_id, data, updated_at')
      .order('user_id', { ascending: true })
      .order('book_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`binder_works 조회 실패: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

function fieldHasContent(field) {
  if (!field || typeof field !== 'object') return false
  return (typeof field.text === 'string' && field.text.trim() !== '') ||
    (Array.isArray(field.strokes) && field.strokes.length > 0)
}

function countDiscardedPageKeys(work, field) {
  if (work.bookId === 'spl-00-01') return 0
  return Object.keys(work[field] ?? {}).filter((page) => {
    const value = Number(page)
    return Number.isInteger(value) && value >= 1 && value <= 6
  }).length
}

function normalizeOldWork(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const parsedUpdatedAt = Date.parse(row.updated_at)
  return {
    ...data,
    bookId: row.book_id,
    transcription: data.transcription ?? { mode: 'text', text: '', strokes: [] },
    notes: data.notes ?? { mode: 'text', text: '', strokes: [] },
    pageInputs: data.pageInputs ?? {},
    pageTextBoxes: data.pageTextBoxes ?? {},
    bookmarks: data.bookmarks ?? [],
    checkpointPages: data.checkpointPages ?? {},
    updatedAt: Number.isFinite(data.updatedAt)
      ? data.updatedAt
      : Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 0,
  }
}

async function backupRows(rows) {
  await mkdir('.migration-backup', { recursive: true, mode: 0o700 })
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const path = `.migration-backup/binder_works_${timestamp}.json`
  await writeFile(path, `${JSON.stringify(rows, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`백업: ${path}\n`)
}

async function main() {
  await loadLocalEnv('.env.local')
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('VITE_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.')
  }

  const sets = await readSets()
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const rows = await readAllRows(supabase)
  if (APPLY) await backupRows(rows)

  const rowsByUser = new Map()
  for (const row of rows) {
    const userRows = rowsByUser.get(row.user_id) ?? []
    userRows.push(row)
    rowsByUser.set(row.user_id, userRows)
  }

  const stats = {
    users: rowsByUser.size,
    oldRows: 0,
    planned: 0,
    skipped: 0,
    ghostRows: 0,
    discardedInputs: 0,
    discardedTextBoxes: 0,
    failedUsers: 0,
  }

  for (const [userId, userRows] of rowsByUser) {
    try {
      const existingIds = new Set(userRows.map((row) => row.book_id))
      const oldWorks = userRows
        .filter((row) => LEGACY_IDS.has(row.book_id))
        .map(normalizeOldWork)
      stats.oldRows += oldWorks.length
      stats.ghostRows += oldWorks.filter(
        (work) => fieldHasContent(work.transcription) || fieldHasContent(work.notes),
      ).length
      stats.discardedInputs += oldWorks.reduce(
        (sum, work) => sum + countDiscardedPageKeys(work, 'pageInputs'),
        0,
      )
      stats.discardedTextBoxes += oldWorks.reduce(
        (sum, work) => sum + countDiscardedPageKeys(work, 'pageTextBoxes'),
        0,
      )

      const migrated = migrateLegacyWorks(oldWorks, sets)
      for (const work of migrated) {
        if (existingIds.has(work.bookId)) {
          stats.skipped += 1
          continue
        }
        stats.planned += 1
        if (!APPLY) continue

        const { error } = await supabase.from('binder_works').insert({
          user_id: userId,
          book_id: work.bookId,
          data: work,
          updated_at: new Date(work.updatedAt).toISOString(),
        })
        if (error) throw new Error(`사용자 ${userId}의 ${work.bookId} 생성 실패: ${error.message}`)
        existingIds.add(work.bookId)
      }
    } catch (error) {
      stats.failedUsers += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`사용자 ${userId} 마이그레이션 실패: ${message}`)
    }
  }

  process.stdout.write(`${APPLY ? 'APPLY' : 'DRY-RUN'} 완료\n`)
  process.stdout.write(`사용자 수: ${stats.users}\n`)
  process.stdout.write(`옛 row 수: ${stats.oldRows}\n`)
  process.stdout.write(`생성 예정 row 수: ${stats.planned}\n`)
  process.stdout.write(`스킵 수: ${stats.skipped}\n`)
  process.stdout.write(`비어있지 않은 transcription·notes row 수: ${stats.ghostRows}\n`)
  process.stdout.write(`폐기된 1~6쪽 pageInputs 건수: ${stats.discardedInputs}\n`)
  process.stdout.write(`폐기된 1~6쪽 pageTextBoxes 건수: ${stats.discardedTextBoxes}\n`)
  process.stdout.write(`실패 사용자 수: ${stats.failedUsers}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`바인더 마이그레이션을 시작하지 못했습니다: ${message}`)
  process.exitCode = 1
})
