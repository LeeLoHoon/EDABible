import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const { drainPendingRef, ResolvedTaskChain, runSingleFlight } =
  await server.ssrLoadModule('/src/persistenceQueue.ts')

after(async () => {
  await server.close()
})

function createHarness(save) {
  const pendingRef = { current: null }
  const flushPromiseRef = { current: null }
  const chain = new ResolvedTaskChain()
  let conflict = false

  const runOne = async (pending) => {
    try {
      const revision = await save(pending)
      const newer = pendingRef.current
      if (newer && newer !== pending && newer.revision < revision) {
        pendingRef.current = { ...newer, revision }
      }
    } catch (error) {
      if (!pendingRef.current) pendingRef.current = pending
      throw error
    }
  }

  return {
    schedule(value) {
      pendingRef.current = value
    },
    pending() {
      return pendingRef.current
    },
    setConflict(value) {
      conflict = value
    },
    flush() {
      if (flushPromiseRef.current) return flushPromiseRef.current
      if (conflict) return Promise.reject(new Error('SERMON_NOTE_STALE_REVISION'))
      return runSingleFlight(flushPromiseRef, () =>
        drainPendingRef(pendingRef, (pending) => chain.run(() => runOne(pending))),
      )
    },
  }
}

test('A in-flight 중 B와 두 flush가 와도 single-flight로 revision을 B에 전달한다', async () => {
  const calls = []
  let releaseA
  let markAStarted
  const gate = new Promise((resolve) => {
    releaseA = resolve
  })
  const started = new Promise((resolve) => {
    markAStarted = resolve
  })
  const harness = createHarness(async (pending) => {
    calls.push({ ...pending })
    if (pending.id === 'A') {
      markAStarted()
      await gate
      return 1
    }
    assert.equal(pending.revision, 1)
    return 2
  })

  harness.schedule({ id: 'A', revision: 0 })
  const first = harness.flush()
  await started
  harness.schedule({ id: 'B', revision: 0 })
  const concurrent = harness.flush()
  assert.equal(concurrent, first)
  releaseA()
  await first

  assert.deepEqual(calls, [
    { id: 'A', revision: 0 },
    { id: 'B', revision: 1 },
  ])
  assert.equal(harness.pending(), null)
})

test('A 실패 중 도착한 B가 latest-wins하며 retry는 B만 한 번 저장한다', async () => {
  const failure = new Error('A failed')
  const calls = []
  let releaseA
  let markAStarted
  const gate = new Promise((resolve) => {
    releaseA = resolve
  })
  const started = new Promise((resolve) => {
    markAStarted = resolve
  })
  const harness = createHarness(async (pending) => {
    calls.push(pending.id)
    if (pending.id === 'A') {
      markAStarted()
      await gate
      throw failure
    }
    return 1
  })

  harness.schedule({ id: 'A', revision: 0 })
  const first = harness.flush()
  await started
  harness.schedule({ id: 'B', revision: 0 })
  assert.equal(harness.flush(), first)
  releaseA()
  await assert.rejects(first, failure)
  assert.equal(harness.pending().id, 'B')

  await harness.flush()
  assert.deepEqual(calls, ['A', 'B'])
  assert.equal(harness.pending(), null)
})

test('새 pending 없는 A 실패는 다음 flush에서 A를 정확히 한 번 retry한다', async () => {
  let attempts = 0
  const harness = createHarness(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('first failed')
    return 1
  })
  harness.schedule({ id: 'A', revision: 0 })
  await assert.rejects(harness.flush(), /first failed/)
  assert.equal(harness.pending().id, 'A')
  await harness.flush()
  assert.equal(attempts, 2)
  assert.equal(harness.pending(), null)
})

test('empty barrier는 저장 없이 resolve하고 conflict gate는 drain을 시작하지 않는다', async () => {
  let calls = 0
  const harness = createHarness(async () => {
    calls += 1
    return 1
  })
  const first = harness.flush()
  assert.equal(harness.flush(), first)
  await first
  assert.equal(calls, 0)

  harness.setConflict(true)
  await assert.rejects(harness.flush(), /SERMON_NOTE_STALE_REVISION/)
  assert.equal(calls, 0)
})
