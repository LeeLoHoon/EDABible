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
const migration = await server.ssrLoadModule('/src/binderMigration.ts')

after(async () => {
  await server.close()
})

const field = (text, mode = 'text') => ({
  mode,
  text,
  strokes: [{ color: '#000', size: 3, points: [[1, 2, 0.5]] }],
})

function work() {
  return {
    bookId: 'set',
    transcription: field(''),
    notes: field(''),
    pageInputs: {
      1: field(' 첫째\n원문 ', 'ink'),
      2: field('둘째'),
      3: field('기존 상자 유지'),
      4: field('   '),
    },
    pageTextBoxes: {
      3: [{ id: 'existing', x: 0.1, y: 0.2, width: 0.3, text: 'existing' }],
    },
    bookmarks: [],
    checkpointPages: {},
    updatedAt: 1,
  }
}

test('모든 대상 쪽을 한 snapshot에서 변환하고 field와 기존 상자를 보존한다', () => {
  const original = work()
  const result = migration.convertLegacyPageText(original)

  assert.equal(result.changed, true)
  assert.notEqual(result.work, original)
  assert.equal(result.work.pageTextBoxes['1'][0].text, ' 첫째\n원문 ')
  assert.equal(result.work.pageTextBoxes['2'][0].text, '둘째')
  assert.deepEqual(result.work.pageTextBoxes['3'], original.pageTextBoxes['3'])
  assert.equal(result.work.pageInputs['1'].text, '')
  assert.equal(result.work.pageInputs['1'].mode, 'ink')
  assert.deepEqual(result.work.pageInputs['1'].strokes, original.pageInputs['1'].strokes)
  assert.equal(result.work.pageInputs['3'].text, '기존 상자 유지')
  assert.equal(result.work.pageInputs['4'].text, '   ')
})

test('변환은 멱등이고 대상이 없으면 동일 참조를 반환한다', () => {
  const first = migration.convertLegacyPageText(work())
  const second = migration.convertLegacyPageText(first.work)

  assert.equal(second.changed, false)
  assert.equal(second.work, first.work)
})

test('owner migration marker는 owner별로 격리된다', () => {
  assert.equal(migration.binderMigrationFlag('owner-a'), 'edabible:binderSetsMigrated:v3:owner-a')
  assert.equal(migration.binderMigrationFlag('owner-b'), 'edabible:binderSetsMigrated:v3:owner-b')
})
