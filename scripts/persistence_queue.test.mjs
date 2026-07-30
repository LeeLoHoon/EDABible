import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const { LatestValueDrain, ResolvedTaskChain, drainPendingRef } =
  await server.ssrLoadModule('/src/persistenceQueue.ts')

after(async () => {
  await server.close()
})

test('pending이 없으면 save를 호출하지 않고 즉시 resolve한다', async () => {
  const pending = { current: null }
  let calls = 0
  await drainPendingRef(pending, async () => {
    calls += 1
  })
  assert.equal(calls, 0)
})

test('pending ref drain은 저장 중 도착한 최신 snapshot까지 배수한다', async () => {
  const pending = { current: { id: 'A' } }
  const saved = []
  let releaseFirst
  let markStarted
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const started = new Promise((resolve) => {
    markStarted = resolve
  })

  const draining = drainPendingRef(pending, async (value) => {
    saved.push(value.id)
    if (value.id === 'A') {
      markStarted()
      await firstGate
    }
  })
  await started
  pending.current = { id: 'B' }
  releaseFirst()
  await draining

  assert.deepEqual(saved, ['A', 'B'])
  assert.equal(pending.current, null)
})

test('pending ref 실패는 예외와 최신 retry snapshot을 함께 보존한다', async () => {
  const original = { id: 'A' }
  const latest = { id: 'B' }
  const pending = { current: original }
  const failure = new Error('write failed')

  await assert.rejects(
    drainPendingRef(pending, async () => {
      pending.current = latest
      throw failure
    }),
    failure,
  )
  assert.equal(pending.current, latest)

  const saved = []
  await drainPendingRef(pending, async (value) => {
    saved.push(value.id)
  })
  assert.deepEqual(saved, ['B'])
})

test('새 snapshot이 없는 실패는 원래 pending을 retry용으로 유지한다', async () => {
  const original = { id: 'A' }
  const pending = { current: original }
  await assert.rejects(
    drainPendingRef(pending, async () => {
      throw new Error('failed')
    }),
    /failed/,
  )
  assert.equal(pending.current, original)
})

test('single-flight latest drain은 A 실패 뒤 B를 A로 덮지 않고 retry한다', async () => {
  const drain = new LatestValueDrain()
  const failure = new Error('A failed')
  let releaseA
  let markAStarted
  const gate = new Promise((resolve) => {
    releaseA = resolve
  })
  const started = new Promise((resolve) => {
    markAStarted = resolve
  })

  drain.schedule('A')
  const first = drain.flush(async (value) => {
    assert.equal(value, 'A')
    markAStarted()
    await gate
    throw failure
  })
  await started
  drain.schedule('B')
  const concurrent = drain.flush(async () => {})
  assert.equal(concurrent, first)
  releaseA()
  await assert.rejects(first, failure)
  assert.equal(drain.getPending(), 'B')

  const saved = []
  await drain.flush(async (value) => {
    saved.push(value)
  })
  assert.deepEqual(saved, ['B'])
  assert.equal(drain.getPending(), null)
})

test('resolved task chain은 현재 오류만 전파하고 tail과 reset은 clean하다', async () => {
  const chain = new ResolvedTaskChain()
  const failure = new Error('current failed')
  const current = chain.run(async () => {
    throw failure
  })

  await assert.rejects(current, failure)
  await chain.wait()
  await chain.waitForCurrent()

  let nextRan = false
  await chain.run(async () => {
    nextRan = true
  })
  assert.equal(nextRan, true)
  chain.reset()
  await chain.waitForCurrent()
})
