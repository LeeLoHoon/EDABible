import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const commit = await server.ssrLoadModule('/src/entryCommit.ts')
const journal = await server.ssrLoadModule('/src/entryJournal.ts')
const queue = await server.ssrLoadModule('/src/persistenceQueue.ts')

after(async () => {
  await server.close()
})

class MemoryStorage {
  values = new Map()

  get length() {
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

const field = (text = '') => ({ mode: 'text', text, strokes: [] })

function entry(id = 'entry-a', updatedAt = 5) {
  return {
    id,
    date: '2026-07-30',
    bibleRef: '시편 1편',
    transcription: field(),
    questionSet: 'meditation',
    answers: [field()],
    spousePrayer: field(),
    prayerTopics: [field()],
    temptationVictory: {
      sin: field(),
      stage: null,
      stageNote: field(),
      help: field(),
      pray: field(),
      victory: field(),
      grow: field(),
    },
    highlightRanges: [],
    createdAt: 1,
    updatedAt,
  }
}

test('entry commit decision은 absent/older만 쓰고 equal/newer를 superseded 처리한다', () => {
  const snapshot = entry('entry-a', 5)

  assert.deepEqual(commit.resolveEntryCommit(undefined, snapshot), {
    write: true,
    result: { status: 'committed', durableUpdatedAt: 5 },
  })
  assert.equal(commit.resolveEntryCommit(entry('entry-a', 4), snapshot).write, true)
  assert.deepEqual(commit.resolveEntryCommit(entry('entry-a', 5), snapshot), {
    write: false,
    result: { status: 'superseded', durableUpdatedAt: 5 },
  })
  assert.deepEqual(commit.resolveEntryCommit(entry('entry-a', 9), snapshot), {
    write: false,
    result: { status: 'superseded', durableUpdatedAt: 9 },
  })
})

test('equal timestamp transaction은 put 없이 superseded를 반환한다', async () => {
  let puts = 0
  const result = await commit.commitEntryInTransaction(
    {
      get: async () => ({ ...entry('entry-a', 5), bibleRef: 'durable-wins' }),
      put: async () => {
        puts += 1
      },
    },
    { ...entry('entry-a', 5), bibleRef: 'candidate-loses' },
  )

  assert.deepEqual(result, { status: 'superseded', durableUpdatedAt: 5 })
  assert.equal(puts, 0)
})

test('transaction re-read 전에 들어온 newer row를 stale snapshot이 덮지 않는다', async () => {
  const values = new Map([['entry-a', entry('entry-a', 3)]])
  let releaseGet
  let markGetStarted
  const getStarted = new Promise((resolve) => {
    markGetStarted = resolve
  })
  const getGate = new Promise((resolve) => {
    releaseGet = resolve
  })
  const tx = {
    async get(id) {
      markGetStarted()
      await getGate
      return values.get(id)
    },
    async put(value) {
      values.set(value.id, value)
    },
  }

  const committing = commit.commitEntryInTransaction(tx, entry('entry-a', 5))
  await getStarted
  values.set('entry-a', entry('entry-a', 9))
  releaseGet()

  assert.deepEqual(await committing, { status: 'superseded', durableUpdatedAt: 9 })
  assert.equal(values.get('entry-a').updatedAt, 9)
})

test('transaction re-read에서 older row를 보면 snapshot을 기록한다', async () => {
  const values = new Map([['entry-a', entry('entry-a', 3)]])
  const result = await commit.commitEntryInTransaction(
    {
      get: async (id) => values.get(id),
      put: async (value) => {
        values.set(value.id, value)
      },
    },
    entry('entry-a', 5),
  )

  assert.deepEqual(result, { status: 'committed', durableUpdatedAt: 5 })
  assert.equal(values.get('entry-a').updatedAt, 5)
})

test('superseded는 정상 drain되고 실제 write 실패만 pending을 보존한다', async () => {
  const stale = entry('entry-a', 5)
  const supersededPending = { current: stale }
  let calls = 0
  await queue.drainPendingRef(supersededPending, async (snapshot) => {
    calls += 1
    await commit.commitEntryInTransaction(
      {
        get: async () => entry('entry-a', 9),
        put: async () => {
          throw new Error('unexpected write')
        },
      },
      snapshot,
    )
  })
  assert.equal(calls, 1)
  assert.equal(supersededPending.current, null)

  const failedPending = { current: stale }
  await assert.rejects(
    queue.drainPendingRef(failedPending, (snapshot) =>
      commit.commitEntryInTransaction(
        {
          get: async () => undefined,
          put: async () => {
            throw new Error('write failed')
          },
        },
        snapshot,
      ),
    ),
    /write failed/,
  )
  assert.equal(failedPending.current, stale)
})

test('durableUpdatedAt만 journal clear 기준으로 사용하면 newer journal은 보존된다', async () => {
  const storage = new MemoryStorage()
  journal.writeEntryJournal(entry('entry-a', 5), storage)
  const superseded = await commit.commitEntryInTransaction(
    {
      get: async () => entry('entry-a', 9),
      put: async () => {
        throw new Error('unexpected write')
      },
    },
    entry('entry-a', 5),
  )
  journal.clearEntryJournal('entry-a', superseded.durableUpdatedAt, storage)
  assert.equal(journal.readEntryJournal('entry-a', storage).status, 'empty')

  const committed = await commit.commitEntryInTransaction(
    {
      get: async () => entry('entry-a', 3),
      put: async () => undefined,
    },
    entry('entry-a', 5),
  )
  journal.writeEntryJournal(entry('entry-a', 10), storage)
  journal.clearEntryJournal('entry-a', committed.durableUpdatedAt, storage)
  assert.equal(journal.readEntryJournal('entry-a', storage).entry.updatedAt, 10)
})

test('commit 중 교체된 equal-timestamp pending journal은 identity guard가 보존한다', async () => {
  const storage = new MemoryStorage()
  const snapshot = entry('entry-a', 5)
  const pendingRef = { current: snapshot }
  journal.writeEntryJournal(snapshot, storage)
  let releaseGet
  let markGetStarted
  const getStarted = new Promise((resolve) => {
    markGetStarted = resolve
  })
  const getGate = new Promise((resolve) => {
    releaseGet = resolve
  })
  const committing = commit.commitEntryInTransaction(
    {
      get: async () => {
        markGetStarted()
        await getGate
        return entry('entry-a', 9)
      },
      put: async () => {
        throw new Error('unexpected write')
      },
    },
    snapshot,
  )

  await getStarted
  const replacement = { ...entry('entry-a', 5), bibleRef: '교체된 equal timestamp payload' }
  pendingRef.current = replacement
  journal.writeEntryJournal(replacement, storage)
  releaseGet()
  const result = await committing

  assert.equal(result.status, 'superseded')
  assert.equal(commit.shouldClearEntryJournalAfterCommit(snapshot, pendingRef.current), false)
  assert.deepEqual(journal.readEntryJournal('entry-a', storage).entry, replacement)
  assert.equal(commit.shouldClearEntryJournalAfterCommit(replacement, pendingRef.current), true)
})
