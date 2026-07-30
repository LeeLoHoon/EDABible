import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const cache = await server.ssrLoadModule('/src/binderCache.ts')

after(async () => {
  await server.close()
})

const field = (text = '') => ({ mode: 'text', text, strokes: [] })
const work = (updatedAt) => ({
  bookId: 'book',
  transcription: field('transcription'),
  notes: field('notes'),
  pageInputs: {},
  pageTextBoxes: {},
  bookmarks: [],
  checkpointPages: {},
  updatedAt,
})

test('remote Binder payload는 cache metadata를 포함하지 않는다', () => {
  const record = cache.toBinderCacheRecord('owner', work(10), true, 4)
  const payload = cache.toRemoteBinderPayload(record)

  assert.deepEqual(Object.keys(payload).sort(), [
    'bookId',
    'bookmarks',
    'checkpointPages',
    'notes',
    'pageInputs',
    'pageTextBoxes',
    'transcription',
    'updatedAt',
  ])
  assert.equal('ownerId' in payload, false)
  assert.equal('dirty' in payload, false)
  assert.equal('syncedUpdatedAt' in payload, false)
})

test('dirty 또는 더 최신 local cache는 stale remote로 교체하지 않는다', () => {
  const dirty = cache.toBinderCacheRecord('owner', work(10), true, 4)
  const newer = cache.toBinderCacheRecord('owner', work(20), false, 20)

  assert.equal(cache.shouldReplaceLocalBinderCache(dirty, work(30)), false)
  assert.equal(cache.shouldReplaceLocalBinderCache(newer, work(19)), false)
  assert.equal(cache.shouldReplaceLocalBinderCache(newer, work(20)), true)
  assert.equal(cache.shouldReplaceLocalBinderCache(undefined, work(1)), true)
})

test('v7 flat record migration은 metadata와 pure work를 분리한다', () => {
  const migrated = cache.migrateBinderCacheRecord({
    ownerId: 'owner',
    ...work(15),
    dirty: true,
    syncedUpdatedAt: 2,
  })

  assert.ok(migrated)
  assert.equal(migrated.bookId, migrated.work.bookId)
  assert.equal(migrated.updatedAt, migrated.work.updatedAt)
  assert.equal(migrated.dirty, false)
  assert.equal(migrated.syncedUpdatedAt, 15)
  assert.equal('ownerId' in migrated.work, false)
  assert.equal('dirty' in migrated.work, false)
})
