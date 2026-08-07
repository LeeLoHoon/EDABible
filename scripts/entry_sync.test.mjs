import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const sync = await server.ssrLoadModule('/src/entrySync.ts')

after(async () => {
  await server.close()
})

function record(id, overrides = {}) {
  return {
    id,
    date: '2026-08-07',
    bibleRef: '시편 3편',
    transcription: { mode: 'text', text: '', strokes: [] },
    answers: [],
    spousePrayer: { mode: 'text', text: '', strokes: [] },
    prayerTopics: [],
    temptationVictory: {},
    highlightRanges: [],
    createdAt: 1,
    updatedAt: 1,
    ownerId: 'user-1',
    revision: 1,
    ...overrides,
  }
}

function meta(entryId, overrides = {}) {
  return { entryId, revision: 1, deleted: false, ...overrides }
}

test('selectEntryPullActions는 받아야 할 것만 고른다', () => {
  const cases = [
    {
      name: '로컬에 없는 원격은 받아온다',
      remote: [meta('a')],
      local: [],
      expected: [{ kind: 'fetch', entryId: 'a' }],
    },
    {
      name: '원격 revision이 앞서면 받아온다',
      remote: [meta('a', { revision: 3 })],
      local: [record('a', { revision: 2 })],
      expected: [{ kind: 'fetch', entryId: 'a' }],
    },
    {
      name: 'revision이 같으면 건드리지 않는다',
      remote: [meta('a', { revision: 2 })],
      local: [record('a', { revision: 2 })],
      expected: [],
    },
    {
      name: '아직 못 올린 편집이 있으면 원격으로 덮지 않는다',
      remote: [meta('a', { revision: 5 })],
      local: [record('a', { revision: 1, dirty: true })],
      expected: [],
    },
    {
      name: 'tombstone은 로컬에서도 지운다',
      remote: [meta('a', { deleted: true })],
      local: [record('a')],
      expected: [{ kind: 'drop', entryId: 'a' }],
    },
    {
      name: '이미 없는 것의 tombstone은 할 일이 없다',
      remote: [meta('a', { deleted: true })],
      local: [],
      expected: [],
    },
    {
      name: '삭제는 로컬 편집보다 우선한다',
      remote: [meta('a', { deleted: true })],
      local: [record('a', { dirty: true })],
      expected: [{ kind: 'drop', entryId: 'a' }],
    },
  ]

  for (const testCase of cases) {
    const local = new Map(testCase.local.map((row) => [row.id, row]))
    assert.deepEqual(
      sync.selectEntryPullActions(testCase.remote, local),
      testCase.expected,
      testCase.name,
    )
  }
})

test('isEntryPushable은 충돌·타계정 행을 걸러 낸다', () => {
  const cases = [
    { name: '올릴 것 없음', row: record('clean'), expected: false },
    { name: '아직 못 올린 편집', row: record('dirty', { dirty: true }), expected: true },
    {
      name: '충돌은 사용자가 고를 때까지 재시도하지 않는다',
      row: record('conflicted', { dirty: true, conflict: true }),
      expected: false,
    },
    {
      name: '다른 계정 행은 건드리지 않는다',
      row: record('other-owner', { dirty: true, ownerId: 'user-2' }),
      expected: false,
    },
  ]
  for (const testCase of cases) {
    assert.equal(sync.isEntryPushable(testCase.row, 'user-1'), testCase.expected, testCase.name)
  }
})

test('applyEntryClaim은 행을 제자리에서 계정 소유로 바꾼다', () => {
  const row = record('local-1', { ownerId: sync.ENTRY_LOCAL_OWNER, revision: 7, conflict: true })
  const returned = sync.applyEntryClaim(row, 'user-1')

  assert.equal(returned, undefined, 'Dexie modify 콜백에서 쓰도록 제자리 수정만 한다')
  assert.equal(row.ownerId, 'user-1')
  // 계정에 처음 올리는 것이므로 insert 경로(revision 0)에서 시작해야 한다
  assert.equal(row.revision, 0)
  assert.equal(row.dirty, true)
  assert.equal(row.conflict, false)
  assert.equal(row.bibleRef, '시편 3편', '본문은 그대로 남는다')
})

test('normalizeRemoteEntry는 손상된 원격 데이터를 거른다', () => {
  const cases = [
    { name: '객체가 아니면 거절', raw: 'nope', expected: null },
    { name: 'null 거절', raw: null, expected: null },
    { name: '배열 거절', raw: [], expected: null },
    { name: 'id 불일치 거절', raw: { id: 'other' }, expected: null },
  ]
  for (const testCase of cases) {
    assert.equal(sync.normalizeRemoteEntry('a', testCase.raw), testCase.expected, testCase.name)
  }
})

test('normalizeRemoteEntry는 빠진 칸을 채우고 모르는 key는 남긴다', () => {
  const entry = sync.normalizeRemoteEntry('a', {
    id: 'a',
    updatedAt: 42,
    highlightRanges: [{ key: '3:12', start: 0, end: 4, color: 'gold' }],
    futureField: 'keep me',
  })

  assert.equal(entry.id, 'a')
  assert.equal(entry.date, '')
  assert.deepEqual(entry.transcription, { mode: 'text', text: '', strokes: [] })
  assert.deepEqual(entry.answers, [])
  assert.equal(entry.createdAt, 42, 'createdAt이 없으면 updatedAt으로 채운다')
  assert.equal(entry.highlightRanges.length, 1, '형광펜은 그대로 살아 있어야 한다')
  assert.equal(entry.futureField, 'keep me', '이 버전이 모르는 필드도 보존한다')
  assert.equal(typeof entry.temptationVictory, 'object')
})

test('serializeEntry는 동기화 메타만 떼어 낸다', () => {
  const payload = sync.serializeEntry(
    record('a', { dirty: true, conflict: false, futureField: 'keep me' }),
  )

  assert.equal('ownerId' in payload, false)
  assert.equal('revision' in payload, false)
  assert.equal('dirty' in payload, false)
  assert.equal('conflict' in payload, false)
  assert.equal(payload.id, 'a')
  assert.equal(payload.futureField, 'keep me')
})

test('서버 오류 코드를 구분한다', () => {
  const stale = { message: 'MEDITATION_ENTRY_STALE_REVISION' }
  const deleted = new Error('MEDITATION_ENTRY_DELETED')

  assert.equal(sync.isStaleEntryError(stale), true)
  assert.equal(sync.isStaleEntryError(deleted), false)
  assert.equal(sync.isDeletedEntryError(deleted), true)
  assert.equal(sync.isStaleEntryError(null), false)
  assert.equal(sync.isDeletedEntryError('그냥 문자열'), false)
})

test('entryRevisionFromResponse는 잘못된 응답을 거절한다', () => {
  assert.equal(sync.entryRevisionFromResponse({ revision: 3 }), 3)
  for (const bad of [null, {}, { revision: 0 }, { revision: 1.5 }, { revision: '2' }]) {
    assert.throws(() => sync.entryRevisionFromResponse(bad), /MEDITATION_ENTRY_INVALID_RESPONSE/)
  }
})
