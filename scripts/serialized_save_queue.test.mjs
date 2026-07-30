import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  define: { __APP_TARGET__: JSON.stringify('all'), __BUILD__: JSON.stringify('test') },
  optimizeDeps: { noDiscovery: true },
})
const { SerializedSaveQueue } = await server.ssrLoadModule('/src/serializedSaveQueue.ts')

after(async () => {
  await server.close()
})

test('같은 key의 저장은 호출 순서대로 완료된다', async () => {
  const queue = new SerializedSaveQueue()
  const events = []
  let releaseFirst
  let markFirstStarted
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve
  })

  const first = queue.run('user:book', async () => {
    events.push('first:start')
    markFirstStarted()
    await firstGate
    events.push('first:end')
  })
  const second = queue.run('user:book', async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await firstStarted
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('앞 저장 오류는 해당 Promise에 전달되고 다음 저장을 막지 않는다', async () => {
  const queue = new SerializedSaveQueue()
  const failure = new Error('remote failed')
  const first = queue.run('user:book', async () => {
    throw failure
  })
  const second = queue.run('user:book', async () => {})

  await assert.rejects(first, failure)
  await second
})
