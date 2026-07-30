import assert from 'node:assert/strict'
import test from 'node:test'

function installStorage(initial, options = {}) {
  const values = new Map(Object.entries(initial))
  const writes = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) {
        if (options.throwOnRead) throw new Error('read blocked')
        return values.get(key) ?? null
      },
      setItem(key, value) {
        if (options.throwOnWrite) throw new Error('write blocked')
        values.set(key, value)
        writes.push([key, value])
      },
    },
  })
  return { values, writes }
}

async function loadVersionModule(label) {
  return import(`../src/bibleVersion.ts?test=${label}-${Date.now()}-${Math.random()}`)
}

test('제거된 persisted 역본은 msg로 fallback하고 storage를 한 번 복구한다', async () => {
  const storage = installStorage({ 'edabible:bibleVersion': 'nkt' })
  const { getBibleVersion } = await loadVersionModule('removed-version')
  assert.equal(getBibleVersion(), 'msg')
  assert.equal(storage.values.get('edabible:bibleVersion'), 'msg')
  assert.deepEqual(storage.writes, [['edabible:bibleVersion', 'msg']])
})

test('localStorage 접근이 차단되어도 msg를 반환한다', async () => {
  installStorage({}, { throwOnRead: true })
  const { getBibleVersion } = await loadVersionModule('blocked-storage')
  assert.equal(getBibleVersion(), 'msg')
})
