import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const db = await readFile(new URL('../src/db.ts', import.meta.url), 'utf8')
const binderMigration = await readFile(new URL('../src/binderMigration.ts', import.meta.url), 'utf8')
const saveFlush = await readFile(new URL('../src/saveFlush.ts', import.meta.url), 'utf8')
const useEntry = await readFile(new URL('../src/hooks/useEntry.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const langToggle = await readFile(new URL('../src/components/LangToggle.tsx', import.meta.url), 'utf8')
const binderPage = await readFile(new URL('../src/pages/BinderPage.tsx', import.meta.url), 'utf8')
const sermonPage = await readFile(new URL('../src/pages/SermonNotePage.tsx', import.meta.url), 'utf8')
const entryJournal = await readFile(new URL('../src/entryJournal.ts', import.meta.url), 'utf8')
const entryCommit = await readFile(new URL('../src/entryCommit.ts', import.meta.url), 'utf8')
const entryTransition = await readFile(new URL('../src/entryTransition.ts', import.meta.url), 'utf8')
const noteTarget = await readFile(new URL('../src/targetApp.note.tsx', import.meta.url), 'utf8')
const allTarget = await readFile(new URL('../src/targetApp.all.tsx', import.meta.url), 'utf8')
const legacyApp = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const entryPage = await readFile(new URL('../src/pages/EntryPage.tsx', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(nextName, start)
  assert.ok(start >= 0 && end > start, `${name} block is missing`)
  return source.slice(start, end)
}

test('flush barrier는 모든 rejection을 AggregateError로 전파하고 reload 실패를 재무장한다', () => {
  assert.match(saveFlush, /Promise\.allSettled/)
  assert.match(saveFlush, /result\.status === 'rejected'/)
  assert.match(saveFlush, /throw new AggregateError\(errors, 'PENDING_SAVES_FAILED'\)/)
  assert.match(useEntry, /\.catch\(\(flushError: unknown\) => \{[\s\S]*setSaveState\('idle'\)[\s\S]*throw flushError/)
  assert.match(main, /async function reloadWhenSafe\(\): Promise<boolean>/)
  assert.match(main, /catch \(error\) \{[\s\S]*reloadingForServiceWorker = false[\s\S]*return false/)
  assert.ok(langToggle.indexOf('setStoredLang(next)') > langToggle.indexOf('await flushPendingSaves()'))
})

test('sermon note remote writes는 authenticated revision CAS RPC만 사용한다', () => {
  assert.match(schema, /alter table public\.sermon_notes[\s\S]*add column if not exists revision integer not null default 1/i)
  assert.match(schema, /drop function if exists public\.put_sermon_note\(uuid, integer, jsonb\)/i)
  const sermonRpc = schema.match(
    /create or replace function public\.put_sermon_note\([\s\S]*?\n\$\$;/i,
  )?.[0]
  assert.ok(sermonRpc)
  assert.match(sermonRpc, /p_owner_user_id uuid[\s\S]*p_sermon_id uuid[\s\S]*p_expected_revision integer[\s\S]*p_data jsonb/i)
  assert.match(sermonRpc, /p_owner_user_id is null or p_owner_user_id <> actor_id[\s\S]*SERMON_NOTE_OWNER_MISMATCH/i)
  assert.match(sermonRpc, /security definer[\s\S]*set search_path = ''[\s\S]*auth\.uid\(\)[\s\S]*pg_advisory_xact_lock[\s\S]*for update[\s\S]*SERMON_NOTE_STALE_REVISION[\s\S]*revision = next_revision/i)
  assert.match(schema, /revoke all on function public\.put_sermon_note\(uuid, uuid, integer, jsonb\) from public, anon, authenticated/i)
  assert.match(schema, /grant execute on function public\.put_sermon_note\(uuid, uuid, integer, jsonb\) to authenticated/i)
  assert.doesNotMatch(schema, /grant execute on function public\.put_sermon_note\(uuid, integer, jsonb\)/i)
  assert.match(
    schema,
    /revoke insert, update on table public\.sermon_notes from public, anon, authenticated/i,
  )
  assert.match(db, /select\('data, revision'\)/)
  assert.doesNotMatch(db, /sermonRemoteRevisions/)
  assert.match(db, /auth\.getSession\(\)[\s\S]*SERMON_NOTE_OWNER_CHANGED/)
  assert.match(db, /rpc\('put_sermon_note'[\s\S]*p_expected_revision: next\.revision/)
  assert.equal(db.match(/p_owner_user_id: userId/g)?.length, 2)
  assert.match(db, /dirty\?: boolean[\s\S]*conflict\?: boolean[\s\S]*baseRevision\?: number/)
  assert.doesNotMatch(db, /from\('sermon_notes'\)\.upsert/)
})

test('binder migration은 local과 remote target data를 읽어 merge 후 upsert하며 source를 삭제하지 않는다', () => {
  assert.match(binderMigration, /edabible:binderSetsMigrated:v3:\$\{ownerId\}/)
  assert.match(binderMigration, /claimLegacyBinderWorks\(userId\)/)
  assert.match(binderMigration, /select\('book_id, data'\)/)
  assert.match(binderMigration, /mergeBinderWorks\(migratedWork, existing, maximumPage\)/)
  assert.match(binderMigration, /from\('binder_works'\)\.upsert/)
  assert.doesNotMatch(binderMigration, /binderWorks\.delete|from\('binder_works'\)\.delete/)
})

test('binder current cache는 owner compound key만 사용하고 legacy store는 claim에서만 읽는다', () => {
  assert.match(db, /binderWorksByOwner: '\[ownerId\+bookId\], ownerId, updatedAt'/)
  assert.match(db, /binderClaims: 'id'/)
  assert.match(db, /this\.version\(8\)/)
  assert.match(db, /sermonNoteClaims: 'sermonId'/)
  assert.match(db, /claimLegacyBinderWorks[\s\S]*db\.transaction\([\s\S]*db\.binderClaims/)
  assert.doesNotMatch(db, /binderWorks\.delete/)

  for (const [name, next] of [
    ['getBinderWork', '/** 계정에서 가장 최근에 사용한 권'],
    ['getLastBinderBookId', 'export async function putBinderWork'],
    ['putBinderWork', 'function normalizeHiddenPages'],
  ]) {
    assert.doesNotMatch(functionBlock(db, name, next), /db\.binderWorks\./)
  }
  const getBlock = functionBlock(db, 'getBinderWork', '/** 계정에서 가장 최근에 사용한 권')
  assert.match(getBlock, /latestLocal[\s\S]*shouldReplaceLocalBinderCache/)
})

test('binder remote save는 user/book queue 안에서 local save 이후 실행된다', () => {
  const start = db.indexOf('export async function putBinderWork')
  const end = db.indexOf('function normalizeHiddenPages', start)
  const putBlock = db.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(putBlock, /db\.transaction\('rw', db\.binderWorksByOwner[\s\S]*dirty/)
  assert.match(putBlock, /binderSaveQueue\.run\(`\$\{userId}:\$\{pending\.bookId}`/)
  assert.match(putBlock, /data: payload/)
  assert.match(putBlock, /latest\.work\.updatedAt > payload\.updatedAt[\s\S]*dirty: false/)
})

test('core drains와 owner-scoped claims가 lifecycle flush에 연결된다', () => {
  assert.match(useEntry, /drainPendingRef\(pendingRef, \(snapshot\) => commitEntry\(snapshot, pendingRef\)\)/)
  assert.match(useEntry, /flushPromiseRef[\s\S]*if \(flushPromiseRef\.current\) return/)
  assert.match(sermonPage, /new ResolvedTaskChain\(\)/)
  assert.match(sermonPage, /flushPromiseRef[\s\S]*runSingleFlight\(flushPromiseRef/)
  assert.match(sermonPage, /drainPendingRef\(pendingNoteRef[\s\S]*saveChainRef\.current\.run/)
  assert.doesNotMatch(sermonPage, /pendingNoteRef\.current = null[\s\S]*saveChainRef\.current\.run/)
  assert.match(binderPage, /new LatestValueDrain<PendingBinderSave>/)
  assert.match(binderPage, /registerSaveFlush\(flushWork\)/)
  assert.match(binderPage, /handleSignOut[\s\S]*await flushWork\(\)[\s\S]*await signOut\(\)/)
  assert.doesNotMatch(binderPage, /onClick=\{signOut\}/)
  assert.match(db, /claimAnonymousSermonNote[\s\S]*db\.sermonNoteClaims/)
  const claimBlock = functionBlock(
    db,
    'claimAnonymousSermonNote',
    'export async function hasSermonNoteConflict',
  )
  const eligibilityPosition = claimBlock.indexOf(
    'if (!shouldInheritAnonymousSermonNote(claim, ownerCache, anonymousCache)) return',
  )
  const claimWritePosition = claimBlock.indexOf('await db.sermonNoteClaims.put(')
  assert.ok(eligibilityPosition >= 0)
  assert.ok(claimWritePosition > eligibilityPosition)
})

test('useEntry hard-reload journal wiring은 synchronous write와 exact commit clear를 사용한다', () => {
  assert.match(useEntry, /const entryRef = useRef<Entry \| null>/)
  assert.match(useEntry, /const journalWrite = writeEntryJournal\(next\)[\s\S]*journalWrite\.status === 'failed'[\s\S]*setEntry\(next\)/)
  assert.match(useEntry, /Math\.max\(Date\.now\(\), previous\.updatedAt \+ 1\)/)
  assert.match(useEntry, /readEntryJournals\(\)[\s\S]*shouldRecoverEntryJournal/)
  assert.match(
    useEntry,
    /await commitEntrySnapshot\(snapshot\)[\s\S]*shouldClearEntryJournalAfterCommit\(snapshot, ownerRef\.current\)[\s\S]*clearEntryJournal\(snapshot\.id, result\.durableUpdatedAt\)/,
  )
  assert.match(entryJournal, /ENTRY_JOURNAL_MAX_CHARS = 1_000_000/)
  assert.match(entryJournal, /ENTRY_JOURNAL_V2_PREFIX/)
  assert.match(entryJournal, /window\.sessionStorage/)
  assert.doesNotMatch(entryJournal, /localStorage/)
})

test('entry commit과 route transition은 atomic commit 및 id guard에 연결된다', () => {
  assert.match(entryCommit, /current\.updatedAt >= snapshot\.updatedAt/)
  assert.match(db, /export async function commitEntrySnapshot/)
  assert.match(db, /db\.transaction\('rw', db\.entries/)
  assert.match(db, /export async function putEntry/)
  assert.match(useEntry, /commitEntrySnapshot/)
  assert.doesNotMatch(useEntry, /\bputEntry\b/)
  assert.match(entryTransition, /export async function runEntryTransition/)
  assert.match(entryTransition, /export async function retryEntryOperation/)
  assert.match(entryTransition, /ENTRY_RETRY_DELAYS_MS = \[500, 1_000\]/)
  assert.match(entryTransition, /export function selectForeignEntryRecoveries/)
  assert.match(entryTransition, /export function selectUpdateBase/)
  assert.match(useEntry, /runEntryTransition\(id, loadedIdRef\.current/)
  assert.match(useEntry, /const loading = id !== loadedId && error === null/)
  assert.match(
    useEntry,
    /selectForeignEntryRecoveries\([\s\S]*journalRead\.entries[\s\S]*for \(const recovery of foreignRecoveries\)/,
  )
  assert.match(useEntry, /selectUpdateBase\(/)
  assert.doesNotMatch(useEntry, /pendingRef\.current \?\? entryRef\.current/)
  assert.match(
    useEntry,
    /await retryEntryOperation\(\(\) => getEntry\(targetId\)\)[\s\S]*if \(!alive \|\| idRef\.current !== targetId\) return[\s\S]*entryRef\.current = next/,
  )
  assert.match(
    useEntry,
    /const clearExposedEntry = \(\) => \{[\s\S]*entryRef\.current = null[\s\S]*loadedIdRef\.current = undefined[\s\S]*setEntry\(null\)[\s\S]*setLoadedId\(null\)/,
  )
  const clearStart = useEntry.indexOf('const clearExposedEntry = () => {')
  const clearEnd = useEntry.indexOf('const run = async () => {', clearStart)
  const clearBlock = useEntry.slice(clearStart, clearEnd)
  assert.ok(clearStart >= 0 && clearEnd > clearStart)
  assert.match(clearBlock, /setLoadedId\(null\)/)
  assert.doesNotMatch(clearBlock, /setLoadedId\(undefined\)/)
  assert.match(
    useEntry,
    /pendingRef\.current\?\.id === targetId[\s\S]*pendingRef\.current !== fallbackCandidateRef\.current[\s\S]*selectLatestEntryRecovery\(matchingPending, recoveredJournal\)/,
  )
  assert.match(useEntry, /error,[\s\S]*editingBlocked,[\s\S]*navigationBlocked,[\s\S]*retry,[\s\S]*update/)
  assert.match(useEntry, /fallbackCandidateRef[\s\S]*journalWrite\.status === 'failed'[\s\S]*void flush\(\)/)
  assert.match(
    useEntry,
    /if \(!navigationBlocked\) return[\s\S]*addEventListener\('beforeunload', onBeforeUnload\)[\s\S]*removeEventListener\('beforeunload', onBeforeUnload\)/,
  )
})

test('Entry routes는 data hash router와 reset-only navigation blocker를 사용한다', () => {
  for (const source of [noteTarget, allTarget, legacyApp]) {
    assert.match(source, /createHashRouter\(\[/)
    assert.match(source, /<RouterProvider router=\{router\} \/>/)
    assert.doesNotMatch(source, /\bHashRouter\b/)
    assert.doesNotMatch(source, /\bRoutes\b|\bRoute\b/)
    assert.ok(source.indexOf('const router = createHashRouter') < source.indexOf('export default function'))
  }

  for (const path of ['/', '/note', '/binder', '/entry/:id', '/sermon', '/sermon/:id', '/qa', '/qa/:id', '*']) {
    assert.match(allTarget, new RegExp(`path: ['"]${path.replace('*', '\\*')}['"]`))
  }
  assert.match(allTarget, /<AuthProvider>[\s\S]*<RouterProvider router=\{router\} \/>[\s\S]*<\/AuthProvider>/)
  assert.match(entryPage, /useBlocker\(navigationBlocked\)/)
  assert.match(entryPage, /blocker\.state === 'blocked'[\s\S]*blocker\.reset\(\)/)
  assert.doesNotMatch(entryPage, /blocker\.proceed\(|\bproceed\(\)/)
  assert.ok(entryPage.indexOf('useBlocker(navigationBlocked)') < entryPage.indexOf('if (error && !entry)'))
})

test('superseded durable reread 뒤 snapshot ownership과 active ID를 다시 검증한다', () => {
  const commitStart = useEntry.indexOf('const commitEntry = useCallback')
  const commitEnd = useEntry.indexOf('// 대기 중인 변경을 즉시 저장', commitStart)
  const commitBlock = useEntry.slice(commitStart, commitEnd)
  const reread = commitBlock.indexOf('durable = await getEntry(snapshot.id)')
  const ownershipRecheck = commitBlock.indexOf('const ownsSnapshot', reread)
  const eligibilityRecheck = commitBlock.indexOf('const canExpose', ownershipRecheck)
  const ownershipReturn = commitBlock.indexOf('if (!ownsSnapshot) return', eligibilityRecheck)
  const journalClear = commitBlock.indexOf('clearEntryJournal(', ownershipReturn)

  assert.ok(commitStart >= 0 && commitEnd > commitStart)
  assert.ok(reread >= 0)
  assert.ok(ownershipRecheck > reread)
  assert.ok(eligibilityRecheck > ownershipRecheck)
  assert.match(
    commitBlock.slice(ownershipRecheck, eligibilityRecheck),
    /ownerRef\.current === snapshot/,
  )
  assert.match(
    commitBlock.slice(eligibilityRecheck, ownershipReturn),
    /ownsSnapshot[\s\S]*idRef\.current === snapshot\.id[\s\S]*loadedIdRef\.current === snapshot\.id/,
  )
  assert.ok(ownershipReturn > eligibilityRecheck)
  assert.ok(journalClear > ownershipReturn)
})

test('journal read bound와 README route contract가 production source에 고정된다', () => {
  const readStart = entryJournal.indexOf('function parseRecord')
  const readEnd = entryJournal.indexOf('function serializeRecord', readStart)
  const readBlock = entryJournal.slice(readStart, readEnd)
  assert.ok(readStart >= 0 && readEnd > readStart)
  assert.ok(readBlock.indexOf('raw.length > ENTRY_JOURNAL_MAX_CHARS') >= 0)
  assert.ok(
    readBlock.indexOf('raw.length > ENTRY_JOURNAL_MAX_CHARS') < readBlock.indexOf('JSON.parse'),
  )
  assert.match(readme, /`\/#\/`\(랜딩\)/)
  assert.match(readme, /`\/#\/note`\(노트 홈\)/)
  assert.doesNotMatch(readme, /`\/#\/`\(노트 홈\)/)
})
