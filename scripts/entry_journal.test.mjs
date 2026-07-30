import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const journal = await server.ssrLoadModule('/src/entryJournal.ts')

after(async () => {
  await server.close()
})

class MemoryStorage {
  values = new Map()
  failLength = false
  failGet = false
  failSet = false
  failRemove = false
  failSetKeys = new Set()

  get length() {
    if (this.failLength) throw new Error('length unavailable')
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    if (this.failGet) throw new Error('get unavailable')
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    if (this.failSet || this.failSetKeys.has(key)) throw new Error('quota exceeded')
    this.values.set(key, value)
  }

  removeItem(key) {
    if (this.failRemove) throw new Error('remove unavailable')
    this.values.delete(key)
  }
}

const field = (text = '') => ({ mode: 'text', text, strokes: [] })

function entry(id = 'entry-a', updatedAt = 10) {
  return {
    id,
    date: '2026-07-30',
    bibleRef: '시편 1편',
    transcription: field('transcription'),
    questionSet: 'meditation',
    answers: [field('answer')],
    spousePrayer: field('spouse'),
    prayerTopics: [field('prayer')],
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

const v2Key = (id) => `${journal.ENTRY_JOURNAL_V2_PREFIX}${encodeURIComponent(id)}`
const legacyRaw = (value) => JSON.stringify({ version: 1, entry: value })

function readFound(storage, id) {
  const result = journal.readEntryJournal(id, storage)
  assert.equal(result.status, 'found')
  return result.entry
}

test('per-ID v2 journal은 A/B가 공존하고 deterministic하게 열거된다', () => {
  const storage = new MemoryStorage()
  const a = entry('entry-a', 20)
  const b = entry('entry-b', 30)
  assert.deepEqual(journal.writeEntryJournal(b, storage), {
    status: 'written',
    key: v2Key('entry-b'),
  })
  assert.deepEqual(journal.writeEntryJournal(a, storage), {
    status: 'written',
    key: v2Key('entry-a'),
  })

  const result = journal.readEntryJournals(storage)
  assert.equal(result.status, 'available')
  assert.deepEqual(result.entries, [a, b])
  assert.deepEqual(readFound(storage, 'entry-a'), a)
  assert.deepEqual(readFound(storage, 'entry-b'), b)
})

test('B write failure는 A journal을 변경하거나 제거하지 않는다', () => {
  const storage = new MemoryStorage()
  const a = entry('entry-a', 20)
  journal.writeEntryJournal(a, storage)
  const aRaw = storage.getItem(v2Key('entry-a'))
  storage.failSetKeys.add(v2Key('entry-b'))

  assert.deepEqual(journal.writeEntryJournal(entry('entry-b', 30), storage), {
    status: 'failed',
    reason: 'storage-unavailable',
  })
  assert.equal(storage.getItem(v2Key('entry-a')), aRaw)
  assert.deepEqual(readFound(storage, 'entry-a'), a)
  assert.equal(journal.readEntryJournal('entry-b', storage).status, 'empty')
})

test('oversize/serialization/quota 실패는 prior A를 byte-for-byte 보존한다', () => {
  const storage = new MemoryStorage()
  journal.writeEntryJournal(entry('entry-a', 10), storage)
  const key = v2Key('entry-a')
  const original = storage.getItem(key)

  assert.deepEqual(
    journal.writeEntryJournal(
      { ...entry('entry-a', 11), bibleRef: 'x'.repeat(journal.ENTRY_JOURNAL_MAX_CHARS) },
      storage,
    ),
    { status: 'failed', reason: 'oversize' },
  )
  assert.equal(storage.getItem(key), original)

  const circular = entry('entry-a', 12)
  circular.extra = circular
  assert.deepEqual(journal.writeEntryJournal(circular, storage), {
    status: 'failed',
    reason: 'serialization-failed',
  })
  assert.equal(storage.getItem(key), original)

  storage.failSetKeys.add(key)
  assert.deepEqual(journal.writeEntryJournal(entry('entry-a', 13), storage), {
    status: 'failed',
    reason: 'storage-unavailable',
  })
  assert.equal(storage.getItem(key), original)
})

test('valid v1은 v2 write/read-back 후 제거되고 hard reload에서 복구된다', () => {
  const storage = new MemoryStorage()
  const legacy = entry('entry-a', 20)
  storage.setItem(journal.ENTRY_JOURNAL_KEY, legacyRaw(legacy))

  const firstRead = journal.readEntryJournals(storage)
  assert.equal(firstRead.status, 'available')
  assert.deepEqual(firstRead.entries, [legacy])
  assert.deepEqual(firstRead.migrationFailedIds, [])
  assert.equal(storage.getItem(journal.ENTRY_JOURNAL_KEY), null)
  assert.ok(storage.getItem(v2Key('entry-a')))

  const afterReload = journal.readEntryJournals(storage)
  assert.equal(afterReload.status, 'available')
  assert.deepEqual(afterReload.entries, [legacy])
})

test('v1/v2 merge는 higher updatedAt을 택하고 equal은 v2를 택한다', () => {
  const newerLegacyStorage = new MemoryStorage()
  const oldV2 = entry('entry-a', 10)
  const newerLegacy = { ...entry('entry-a', 20), bibleRef: 'legacy-newer' }
  journal.writeEntryJournal(oldV2, newerLegacyStorage)
  newerLegacyStorage.setItem(journal.ENTRY_JOURNAL_KEY, legacyRaw(newerLegacy))
  assert.deepEqual(readFound(newerLegacyStorage, 'entry-a'), newerLegacy)
  assert.equal(newerLegacyStorage.getItem(journal.ENTRY_JOURNAL_KEY), null)

  const tiedStorage = new MemoryStorage()
  const tiedV2 = { ...entry('entry-a', 20), bibleRef: 'v2-wins' }
  const tiedLegacy = { ...entry('entry-a', 20), bibleRef: 'legacy-loses' }
  journal.writeEntryJournal(tiedV2, tiedStorage)
  tiedStorage.setItem(journal.ENTRY_JOURNAL_KEY, legacyRaw(tiedLegacy))
  assert.deepEqual(readFound(tiedStorage, 'entry-a'), tiedV2)
  assert.equal(tiedStorage.getItem(journal.ENTRY_JOURNAL_KEY), null)
})

test('v1 migration failure는 v1을 유지하고 recovery entry를 계속 노출한다', () => {
  const storage = new MemoryStorage()
  const legacy = entry('entry-a', 20)
  const raw = legacyRaw(legacy)
  storage.setItem(journal.ENTRY_JOURNAL_KEY, raw)
  storage.failSetKeys.add(v2Key('entry-a'))

  const result = journal.readEntryJournals(storage)
  assert.equal(result.status, 'available')
  assert.deepEqual(result.entries, [legacy])
  assert.deepEqual(result.migrationFailedIds, ['entry-a'])
  assert.equal(storage.getItem(journal.ENTRY_JOURNAL_KEY), raw)
  assert.equal(storage.getItem(v2Key('entry-a')), null)
})

test('storage unavailable은 available empty와 구별된다', () => {
  const empty = journal.readEntryJournals(new MemoryStorage())
  assert.deepEqual(empty, {
    status: 'available',
    entries: [],
    invalidKeys: [],
    migrationFailedIds: [],
  })

  const unavailable = new MemoryStorage()
  unavailable.failLength = true
  assert.deepEqual(journal.readEntryJournals(unavailable), {
    status: 'unavailable',
    entries: [],
  })
  assert.deepEqual(journal.readEntryJournal('entry-a', unavailable), {
    status: 'unavailable',
  })
})

test('malformed v2는 제거하지 않고 structured invalid로 보고한다', () => {
  const storage = new MemoryStorage()
  const key = v2Key('entry-a')
  storage.setItem(key, '{not-json')
  const result = journal.readEntryJournals(storage)
  assert.equal(result.status, 'available')
  assert.deepEqual(result.entries, [])
  assert.deepEqual(result.invalidKeys, [key])
  assert.equal(storage.getItem(key), '{not-json')
  assert.equal(journal.readEntryJournal('entry-a', storage).status, 'invalid')
})

test('raw record는 1,000,000 chars bound를 JSON.parse 전에 적용하고 보존한다', () => {
  const storage = new MemoryStorage()
  const key = v2Key('entry-a')
  const oversized = 'x'.repeat(journal.ENTRY_JOURNAL_MAX_CHARS + 1)
  storage.setItem(key, oversized)
  const originalParse = JSON.parse
  let parseCalls = 0
  JSON.parse = () => {
    parseCalls += 1
    throw new Error('oversized journal must not be parsed')
  }

  try {
    const result = journal.readEntryJournals(storage)
    assert.equal(result.status, 'available')
    assert.deepEqual(result.entries, [])
  } finally {
    JSON.parse = originalParse
  }
  assert.equal(parseCalls, 0)
  assert.equal(storage.getItem(key), oversized)
})

test('clear는 해당 ID의 not-newer v2/legacy만 제거한다', () => {
  const storage = new MemoryStorage()
  const a = entry('entry-a', 20)
  const b = entry('entry-b', 30)
  journal.writeEntryJournal(a, storage)
  journal.writeEntryJournal(b, storage)
  journal.clearEntryJournal('entry-a', 19, storage)
  assert.deepEqual(readFound(storage, 'entry-a'), a)
  journal.clearEntryJournal('entry-a', 20, storage)
  assert.equal(journal.readEntryJournal('entry-a', storage).status, 'empty')
  assert.deepEqual(readFound(storage, 'entry-b'), b)

  storage.setItem(journal.ENTRY_JOURNAL_KEY, legacyRaw(entry('entry-c', 40)))
  journal.clearEntryJournal('entry-a', 100, storage)
  assert.ok(storage.getItem(journal.ENTRY_JOURNAL_KEY))
  journal.clearEntryJournal('entry-c', 39, storage)
  assert.ok(storage.getItem(journal.ENTRY_JOURNAL_KEY))
  journal.clearEntryJournal('entry-c', 40, storage)
  assert.equal(storage.getItem(journal.ENTRY_JOURNAL_KEY), null)
})

test('same-id journal은 durable row보다 strictly newer일 때만 복구한다', () => {
  const latest = entry('entry-a', 20)
  assert.equal(journal.shouldRecoverEntryJournal(latest, entry('entry-a', 19)), true)
  assert.equal(journal.shouldRecoverEntryJournal(latest, entry('entry-a', 20)), false)
  assert.equal(journal.shouldRecoverEntryJournal(latest, entry('entry-b', 1)), false)
  assert.equal(journal.shouldRecoverEntryJournal(latest, undefined), true)
})
