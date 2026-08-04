/* 묵상 보관함 목록 조립 — 정렬·그룹핑·주차 집계.
   화면에서 떼어 낸 순수 로직이라 DOM 없이 그대로 검증한다. */

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
const { buildArchiveRows, countWrittenWeeks, groupByYearMonth, mergeNoteSummaries } =
  await server.ssrLoadModule('/src/sermonArchive.ts')

after(async () => {
  await server.close()
})

const note = (sermonId, preachedOn, service = 'morning', extra = {}) => ({
  sermonId,
  preachedOn,
  service,
  title: `${preachedOn} ${service}`,
  passages: [],
  updatedAt: 1,
  revision: 1,
  highlightCount: 0,
  answeredPoints: 0,
  writtenFields: 0,
  ...extra,
})

const sermon = (id, preachedOn, service = 'morning', published = true) => ({
  id,
  service,
  preachedOn,
  title: `${preachedOn} ${service}`,
  preacher: '',
  passages: [],
  summary: '',
  points: [],
  mediaUrl: '',
  published,
  updatedAt: 1,
})

test('내 묵상 보기는 기록이 있는 주일만, 최신순·오전 먼저로 늘어놓는다', () => {
  const notes = [
    note('b', '2026-07-26', 'afternoon'),
    note('d', '2025-12-28'),
    note('a', '2026-07-26'),
    note('c', '2026-08-02'),
  ]
  const rows = buildArchiveRows(notes, [], false)

  assert.deepEqual(
    rows.map((row) => `${row.preachedOn}/${row.service}`),
    ['2026-08-02/morning', '2026-07-26/morning', '2026-07-26/afternoon', '2025-12-28/morning'],
  )
  assert.ok(rows.every((row) => row.note))
})

test('전체 보기는 기록 없는 주일도 함께 보여준다', () => {
  const notes = [note('a', '2026-08-02')]
  const sermons = [sermon('a', '2026-08-02'), sermon('b', '2026-07-26')]
  const rows = buildArchiveRows(notes, sermons, true)

  assert.equal(rows.length, 2)
  assert.ok(rows[0].note, '기록이 있는 주일에는 note가 붙는다')
  assert.equal(rows[1].note, undefined, '기록이 없는 주일은 note가 비어 있다')
})

test('게시가 내려간 설교는 감추되 내 묵상이 달렸으면 계속 보인다', () => {
  const sermons = [
    sermon('kept', '2026-08-02', 'morning', false),
    sermon('hidden', '2026-07-26', 'morning', false),
  ]
  const rows = buildArchiveRows([note('kept', '2026-08-02')], sermons, true)

  assert.deepEqual(rows.map((row) => row.sermonId), ['kept'])
})

test('연 → 월로 묶고 각 묶음은 시간순으로 뒤집어 읽을 수 있다', () => {
  const rows = buildArchiveRows(
    [note('a', '2026-08-02'), note('b', '2026-07-26'), note('c', '2025-12-28')],
    [],
    false,
  )
  const grouped = groupByYearMonth(rows)

  assert.deepEqual([...grouped.keys()].sort().reverse(), ['2026', '2025'])
  assert.deepEqual([...(grouped.get('2026') ?? new Map()).keys()].sort().reverse(), ['08', '07'])
  assert.equal((grouped.get('2025') ?? new Map()).get('12').length, 1)
})

test('그 해 묵상 주차는 같은 주일의 오전·오후를 한 번으로 센다', () => {
  const notes = [
    note('a', '2026-08-02'),
    note('b', '2026-08-02', 'afternoon'),
    note('c', '2026-07-26'),
    note('d', '2025-12-28'),
  ]

  assert.equal(countWrittenWeeks(notes, '2026'), 2)
  assert.equal(countWrittenWeeks(notes, '2025'), 1)
  assert.equal(countWrittenWeeks(notes, '2024'), 0)
  // 연도 접두어가 '202'처럼 부분 일치해도 새어 나가지 않는다
  assert.equal(countWrittenWeeks(notes, '202'), 0)
})

test('서버에 못 올라간 기기 기록도 보관함에서 사라지지 않는다', () => {
  const remote = [note('a', '2026-08-02', 'morning', { updatedAt: 100 })]
  const local = [
    // 서버에 아직 없는 기록 — 저장 실패나 오프라인
    note('b', '2026-07-26', 'morning', { updatedAt: 200, pendingSync: true }),
    // 서버에도 있지만 기기 쪽이 더 최근
    note('a', '2026-08-02', 'morning', { updatedAt: 300, pendingSync: true }),
  ]
  const merged = mergeNoteSummaries(remote, local)

  assert.equal(merged.length, 2)
  const a = merged.find((item) => item.sermonId === 'a')
  assert.equal(a.updatedAt, 300, '더 최근에 손댄 기기 기록을 남긴다')
  assert.equal(a.pendingSync, true)
  assert.ok(merged.some((item) => item.sermonId === 'b'))
})

test('서버 쪽이 더 최근이면 서버 기록을 남긴다', () => {
  const remote = [note('a', '2026-08-02', 'morning', { updatedAt: 500 })]
  const local = [note('a', '2026-08-02', 'morning', { updatedAt: 100, pendingSync: true })]
  const merged = mergeNoteSummaries(remote, local)

  assert.equal(merged.length, 1)
  assert.equal(merged[0].updatedAt, 500)
  assert.equal(merged[0].pendingSync, undefined)
})

test('빈 입력에도 무너지지 않는다', () => {
  assert.deepEqual(buildArchiveRows([], [], false), [])
  assert.deepEqual(buildArchiveRows([], [], true), [])
  assert.equal(groupByYearMonth([]).size, 0)
  assert.equal(countWrittenWeeks([], '2026'), 0)
  assert.deepEqual(mergeNoteSummaries([], []), [])
})
