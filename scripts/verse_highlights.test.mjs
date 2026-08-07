import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const vh = await server.ssrLoadModule('/src/verseHighlights.ts')
const { splitBlocks } = await server.ssrLoadModule('/src/passageBlocks.ts')

after(async () => {
  await server.close()
})

/** 장 하나를 담은 본문 조각 — 실제 BiblePicker/sermon.ts가 만드는 모양 */
function chunk(bookOrder, chapter, text, label = `${bookOrder}권 ${chapter}장`) {
  return { label, text, bookOrder, chapter }
}

const PSALM_1 = '(1)복 있는 사람은\n(2)오직 여호와의 율법을'
const PSALM_2 = '(1)어찌하여 이방 나라들이\n(2)세상의 군왕들이'

test('앵커는 화면 키와 절대 좌표를 잇는다', () => {
  const blocks = splitBlocks([chunk(19, 1, PSALM_1)], 1)
  const anchors = vh.buildHighlightAnchors(blocks)

  assert.equal(anchors.length, 2)
  assert.deepEqual(
    anchors.map((a) => [a.verseKey, a.bookOrder, a.chapter, a.chapterVerseKey]),
    [
      ['1:1', 19, 1, '1'],
      ['1:2', 19, 1, '2'],
    ],
  )
})

test('시작 장이 달라도 같은 구절은 같은 절대 좌표를 얻는다', () => {
  // 시편 2편만 보는 묵상과, 시편 1-2편을 보는 묵상
  const alone = vh.buildHighlightAnchors(splitBlocks([chunk(19, 2, PSALM_2)], 2))
  const withPrev = vh.buildHighlightAnchors(
    splitBlocks([chunk(19, 1, PSALM_1), chunk(19, 2, PSALM_2)], 1),
  )

  const psalm2Alone = alone.find((a) => a.chapterVerseKey === '1')
  const psalm2Together = withPrev.filter((a) => a.chapter === 2).find((a) => a.chapterVerseKey === '1')

  assert.equal(psalm2Alone.bookOrder, 19)
  assert.equal(psalm2Alone.chapter, 2)
  assert.equal(psalm2Together.bookOrder, 19)
  assert.equal(psalm2Together.chapter, 2)
  // 화면 키(verseKey)는 본문 범위에 따라 달라질 수 있어도 절대 좌표는 같아야 한다
  assert.equal(vh.chapterKey(psalm2Alone), vh.chapterKey(psalm2Together))
})

test('절 마커가 없는 문단은 장 안에서의 순번으로 식별한다', () => {
  const blocks = splitBlocks([chunk(19, 5, '마커 없는 첫 문단\n마커 없는 둘째 문단')], 5)
  const anchors = vh.buildHighlightAnchors(blocks)

  assert.deepEqual(
    anchors.map((a) => a.chapterVerseKey),
    ['p0', 'p1'],
    '전체 블록 인덱스가 아니라 장 안에서 0부터 센다',
  )
  assert.equal(anchors[0].chapter, 5)
})

test('장 좌표를 모르는 조각은 공유 대상에서 빠진다', () => {
  // 본문 여러 개일 때 끼우는 참조 줄 — bookOrder/chapter가 없다
  const blocks = splitBlocks([{ label: null, text: '시편 1편' }, chunk(19, 1, PSALM_1)], 1)
  const anchors = vh.buildHighlightAnchors(blocks)

  assert.ok(
    anchors.every((a) => typeof a.bookOrder === 'number'),
    '좌표 없는 조각은 앵커가 되지 않는다',
  )
})

test('chapterRefsOf는 본문이 걸친 장을 중복 없이 모은다', () => {
  const blocks = splitBlocks([chunk(19, 1, PSALM_1), chunk(19, 2, PSALM_2)], 1)
  const refs = vh.chapterRefsOf(vh.buildHighlightAnchors(blocks))

  assert.deepEqual(refs, [
    { bookOrder: 19, chapter: 1 },
    { bookOrder: 19, chapter: 2 },
  ])
})

test('저장된 밑줄은 지금 본문의 구절에만 되살아난다', () => {
  const blocks = splitBlocks([chunk(19, 1, PSALM_1)], 1)
  const anchors = vh.buildHighlightAnchors(blocks)

  const stored = new Map([
    // 시편 1편 1절에 그은 밑줄
    ['19:1', [{ key: '1', start: 0, end: 3, color: 'gold' }]],
    // 시편 2편에 그은 밑줄 — 지금 본문에 없으므로 나오면 안 된다
    ['19:2', [{ key: '1', start: 0, end: 5, color: 'pink' }]],
    // 다른 책의 같은 장·절 — 절대 섞이면 안 된다
    ['20:1', [{ key: '1', start: 0, end: 4, color: 'green' }]],
  ])

  const ranges = vh.toRenderRanges(anchors, stored)
  assert.equal(ranges.length, 1)
  assert.deepEqual(ranges[0], { key: '1:1', start: 0, end: 3, color: 'gold' })
})

test('화면 좌표의 밑줄은 장별로 나뉘어 저장된다', () => {
  const blocks = splitBlocks([chunk(19, 1, PSALM_1), chunk(19, 2, PSALM_2)], 1)
  const anchors = vh.buildHighlightAnchors(blocks)
  const psalm2First = anchors.find((a) => a.chapter === 2 && a.chapterVerseKey === '1')

  const grouped = vh.groupRangesByChapter(anchors, [
    { key: '1:1', start: 0, end: 3, color: 'gold' },
    { key: psalm2First.verseKey, start: 1, end: 4, color: 'pink' },
    { key: '존재하지-않는-키', start: 0, end: 2, color: 'green' },
  ])

  assert.deepEqual([...grouped.keys()].sort(), ['19:1', '19:2'])
  assert.deepEqual(grouped.get('19:1'), [{ key: '1', start: 0, end: 3, color: 'gold' }])
  assert.deepEqual(grouped.get('19:2'), [{ key: '1', start: 1, end: 4, color: 'pink' }])
})

test('행 키는 소유자·역본·장을 모두 가른다', () => {
  const ref = { bookOrder: 19, chapter: 1 }
  const keys = [
    vh.highlightRowKey('user-1', 'msg', ref),
    vh.highlightRowKey('user-2', 'msg', ref),
    vh.highlightRowKey('user-1', 'gae', ref),
    vh.highlightRowKey('user-1', 'msg', { bookOrder: 19, chapter: 2 }),
    vh.highlightRowKey('user-1', 'msg', { bookOrder: 20, chapter: 1 }),
  ]
  assert.equal(new Set(keys).size, keys.length, '어느 축이 달라도 다른 행이어야 한다')
})

test('selectHighlightPulls는 받아야 할 장만 고른다', () => {
  const remote = [
    { version: 'msg', bookOrder: 19, chapter: 1, revision: 3 },
    { version: 'msg', bookOrder: 19, chapter: 2, revision: 1 },
    { version: 'msg', bookOrder: 19, chapter: 3, revision: 5 },
    { version: 'gae', bookOrder: 19, chapter: 1, revision: 2 },
  ]
  const local = new Map([
    // 최신이라 받을 필요 없음
    [vh.highlightRowKey('u', 'msg', { bookOrder: 19, chapter: 2 }), { revision: 1 }],
    // 아직 못 올린 편집이 있으면 원격으로 덮지 않는다
    [vh.highlightRowKey('u', 'msg', { bookOrder: 19, chapter: 3 }), { revision: 1, dirty: true }],
  ])

  const picked = vh.selectHighlightPulls(remote, local, 'u')
  assert.deepEqual(
    picked.map((m) => `${m.version}:${m.bookOrder}:${m.chapter}`),
    ['msg:19:1', 'gae:19:1'],
  )
})

test('normalizeRemoteRanges는 손상된 항목을 버린다', () => {
  const ranges = vh.normalizeRemoteRanges([
    { key: '1', start: 0, end: 3, color: 'gold' },
    { key: '2', start: 3, end: 3, color: 'gold' }, // 빈 구간
    { key: '3', start: 0, end: 2, color: 'purple' }, // 없는 색
    { key: 4, start: 0, end: 2, color: 'gold' }, // 키가 문자열이 아님
    'nope',
    null,
  ])
  assert.deepEqual(ranges, [{ key: '1', start: 0, end: 3, color: 'gold' }])
  assert.deepEqual(vh.normalizeRemoteRanges('배열 아님'), [])
})

test('isHighlightPushable은 충돌·타계정 행을 걸러 낸다', () => {
  const base = { ownerId: 'u', version: 'msg', bookOrder: 19, chapter: 1, ranges: [], revision: 0, updatedAt: 1 }
  assert.equal(vh.isHighlightPushable({ ...base, dirty: true }, 'u'), true)
  assert.equal(vh.isHighlightPushable({ ...base }, 'u'), false)
  assert.equal(vh.isHighlightPushable({ ...base, dirty: true, conflict: true }, 'u'), false)
  assert.equal(vh.isHighlightPushable({ ...base, dirty: true }, 'other'), false)
})

test('parseChapterKey는 chapterKey를 되돌린다', () => {
  assert.deepEqual(vh.parseChapterKey(vh.chapterKey({ bookOrder: 19, chapter: 23 })), {
    bookOrder: 19,
    chapter: 23,
  })
  assert.equal(vh.parseChapterKey('망가진키'), null)
})
