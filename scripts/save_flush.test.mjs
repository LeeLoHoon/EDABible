import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const saveFlush = await server.ssrLoadModule('/src/saveFlush.ts')

after(async () => {
  await server.close()
})

test('모든 flusher가 성공하면 resolve하고 해제된 flusher는 호출하지 않는다', async () => {
  let calls = 0
  const unregisterFirst = saveFlush.registerSaveFlush(async () => {
    calls += 1
  })
  const unregisterRemoved = saveFlush.registerSaveFlush(async () => {
    calls += 100
  })
  unregisterRemoved()

  await saveFlush.flushPendingSaves()
  assert.equal(calls, 1)
  unregisterFirst()
})

test('하나의 실패도 AggregateError로 전파하면서 모든 flusher를 실행한다', async () => {
  const calls = []
  const firstError = new Error('first')
  const unregister = [
    saveFlush.registerSaveFlush(async () => {
      calls.push('first')
      throw firstError
    }),
    saveFlush.registerSaveFlush(async () => {
      calls.push('second')
    }),
  ]

  await assert.rejects(saveFlush.flushPendingSaves(), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [firstError])
    return true
  })
  assert.deepEqual(calls, ['first', 'second'])
  unregister.forEach((remove) => remove())
})

test('여러 실패를 하나의 AggregateError에 모두 보존한다', async () => {
  const errors = [new Error('one'), new Error('two')]
  const unregister = errors.map((failure) =>
    saveFlush.registerSaveFlush(async () => {
      throw failure
    }),
  )

  await assert.rejects(saveFlush.flushPendingSaves(), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, errors)
    return true
  })
  unregister.forEach((remove) => remove())
})

test('동기 throw도 나머지 flusher 실행을 막지 않는다', async () => {
  let laterRan = false
  const unregister = [
    saveFlush.registerSaveFlush(() => {
      throw new Error('synchronous')
    }),
    saveFlush.registerSaveFlush(async () => {
      laterRan = true
    }),
  ]

  await assert.rejects(saveFlush.flushPendingSaves(), AggregateError)
  assert.equal(laterRan, true)
  unregister.forEach((remove) => remove())
})
