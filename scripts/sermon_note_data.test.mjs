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
const dbModule = await server.ssrLoadModule('/src/db.ts')

after(async () => {
  await server.close()
})

const field = (text) => ({ mode: 'text', text, strokes: [] })

test('point 수가 줄어도 저장된 답과 모든 역본 highlight를 보존한다', () => {
  const note = dbModule.normalizeSermonNoteData(
    '123e4567-e89b-12d3-a456-426614174000',
    1,
    {
      pointAnswers: [field('one'), field('two'), field('three')],
      impression: field('impression'),
      application: field('application'),
      freeNote: field('free'),
      highlightRanges: [],
      highlightVersions: { msg: [], nkt: [{ key: 'p0', start: 0, end: 1, color: 'gold' }] },
      updatedAt: 10,
    },
    4,
  )

  assert.deepEqual(note.pointAnswers.map((answer) => answer.text), ['one', 'two', 'three'])
  assert.deepEqual(Object.keys(note.highlightVersions).sort(), ['msg', 'nkt'])
  assert.equal(note.impression.text, 'impression')
  assert.equal(note.application.text, 'application')
  assert.equal(note.revision, 4)
})

test('legacy unknown data는 known field 아래 보존되고 helper metadata는 JSON에 새지 않는다', () => {
  const sermonId = '123e4567-e89b-12d3-a456-426614174000'
  const note = dbModule.normalizeSermonNoteData(sermonId, 0, {
    sermonId,
    pointAnswers: [],
    freeNote: field('known'),
    legacyPrayer: { text: 'preserve me' },
    legacyFlag: true,
    dirty: true,
    conflict: true,
    baseRevision: 7,
    updatedAt: 10,
  })
  note.freeNote = field('new known value')

  const serialized = JSON.parse(JSON.stringify(dbModule.serializeSermonNoteData(note)))
  assert.deepEqual(serialized.legacyPrayer, { text: 'preserve me' })
  assert.equal(serialized.legacyFlag, true)
  assert.equal(serialized.freeNote.text, 'new known value')
  assert.equal(serialized.preservedEntries, undefined)
  assert.equal(serialized.revision, undefined)
  assert.equal(serialized.dirty, undefined)
  assert.equal(serialized.conflict, undefined)
  assert.equal(serialized.baseRevision, undefined)
})
