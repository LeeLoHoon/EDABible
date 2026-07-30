import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const { shouldInheritAnonymousSermonNote } = await server.ssrLoadModule('/src/sermonClaim.ts')

after(async () => {
  await server.close()
})

const claim = { sermonId: 'sermon', ownerId: 'owner-a', claimedAt: 1 }
const cache = { key: 'present' }

test('claim과 owner cache가 없고 anonymous source가 있을 때만 상속한다', () => {
  assert.equal(shouldInheritAnonymousSermonNote(undefined, undefined, cache), true)
  assert.equal(shouldInheritAnonymousSermonNote(undefined, undefined, undefined), false)
})

test('어떤 owner의 claim이든 중복 상속을 막는다', () => {
  assert.equal(shouldInheritAnonymousSermonNote(claim, undefined, cache), false)
  assert.equal(
    shouldInheritAnonymousSermonNote({ ...claim, ownerId: 'owner-b' }, undefined, cache),
    false,
  )
})

test('authenticated owner cache가 이미 있으면 anonymous source를 복사하지 않는다', () => {
  assert.equal(shouldInheritAnonymousSermonNote(undefined, cache, cache), false)
})
