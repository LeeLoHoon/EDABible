/* 설교 절 범위 표기(verseLabel) → 본문 자르기.
   실제 역본 본문을 그대로 먹여 확인한다 — 역본마다 절 마커 정밀도가 달라서
   인라인 샘플만으로는 메시지 성경의 겹치는 범위형 마커를 재현하지 못한다. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  define: { __APP_TARGET__: JSON.stringify('all'), __BUILD__: JSON.stringify('test') },
  optimizeDeps: { noDiscovery: true },
})
const { parseVerseLabel, sliceVerses } = await server.ssrLoadModule('/src/verseRange.ts')

after(async () => {
  await server.close()
})

/** public/bible[/역본]/ 에서 장 본문을 읽는다 */
function chapterText(version, bookGlob, chapter) {
  const dir = version === 'msg' ? 'public/bible' : `public/bible/${version}`
  const [file] = globSync(`${dir}/${bookGlob}.json`)
  assert.ok(file, `${version} ${bookGlob} 본문을 찾지 못했다`)
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const found = doc.chapters.find((item) => item.chapter === chapter)
  assert.ok(found, `${version} ${bookGlob} ${chapter}장이 없다`)
  return found.text
}

const markersOf = (text) => [...text.matchAll(/\((\d{1,3}(?:[-~]\d{1,3})?)\)/g)].map((m) => m[1])

test('절 범위 표기를 장별 범위로 파싱한다', () => {
  const cases = [
    { label: '13:8-10', fallback: 13, expect: [[13, [{ from: 8, to: 10 }]]] },
    { label: '2:17', fallback: 2, expect: [[2, [{ from: 17, to: 17 }]]] },
    // 장을 생략하면 본문의 시작 장 소속으로 읽는다
    { label: '8-10', fallback: 13, expect: [[13, [{ from: 8, to: 10 }]]] },
    { label: '17', fallback: 2, expect: [[2, [{ from: 17, to: 17 }]]] },
    { label: '8:28-30, 9:1', fallback: 8, expect: [[8, [{ from: 28, to: 30 }]], [9, [{ from: 1, to: 1 }]]] },
    // 물결표도 하이픈과 같게 읽고, 뒤집어 적어도 의도대로 본다
    { label: '1:3~5', fallback: 1, expect: [[1, [{ from: 3, to: 5 }]]] },
    { label: '1:10-8', fallback: 1, expect: [[1, [{ from: 8, to: 10 }]]] },
    // 같은 장에 여러 범위
    { label: '1:1-2, 1:5', fallback: 1, expect: [[1, [{ from: 1, to: 2 }, { from: 5, to: 5 }]]] },
  ]

  for (const { label, fallback, expect } of cases) {
    assert.deepEqual([...parseVerseLabel(label, fallback)], expect, label)
  }
})

test('해석할 수 없는 표기는 빈 결과라 본문을 감추지 않는다', () => {
  for (const label of [undefined, '', '   ', '아무말', '13:', ':8', '1:1-2:3']) {
    assert.equal(parseVerseLabel(label, 1).size, 0, String(label))
  }
})

test('메시지 성경: 겹치는 범위형 마커에서 요청 절이 든 문단만 남는다', () => {
  // 로마서 13장 = (1-3) (3-5) (6-7) (8-10) (11-14)
  const full = chapterText('msg', '*롬*', 13)
  const sliced = sliceVerses(full, [{ from: 8, to: 10 }])

  assert.deepEqual(markersOf(sliced), ['8-10'])
  assert.ok(sliced.length < full.length)
  // 소제목은 살아남은 본문을 따라간다
  assert.ok(sliced.startsWith('[[그리스도인과 세상 권세]]'))
})

test('메시지 성경: 요청 범위에 걸친 문단은 통째로 남는다', () => {
  // 8절만 요청해도 (8-10) 문단은 쪼갤 수 없으므로 그대로 나온다
  const full = chapterText('msg', '*롬*', 13)
  assert.deepEqual(markersOf(sliceVerses(full, [{ from: 8, to: 8 }])), ['8-10'])
  // 3절은 (1-3)과 (3-5) 두 문단에 걸쳐 있다
  assert.deepEqual(markersOf(sliceVerses(full, [{ from: 3, to: 3 }])), ['1-3', '3-5'])
})

test('메시지 성경: 마커 없이 시작하는 선두 문단을 1절로 지킨다', () => {
  // 시편 1편은 (2-3)부터 마커가 붙어 선두 문단에 마커가 없다
  const full = chapterText('msg', '*시*', 1)
  assert.deepEqual(markersOf(full), ['2-3', '4-5'])

  const lead = sliceVerses(full, [{ from: 1, to: 1 }])
  assert.deepEqual(markersOf(lead), [])
  assert.ok(lead.startsWith('그대, 하나님께서 좋아하실 수밖에!'))

  // 2-3절만 요청하면 선두 문단은 빠진다
  const middle = sliceVerses(full, [{ from: 2, to: 3 }])
  assert.deepEqual(markersOf(middle), ['2-3'])
  assert.ok(!middle.includes('그대, 하나님께서 좋아하실 수밖에!'))
})

test('개역·새번역·영문: 절 단위 마커는 요청대로 정확히 잘린다', () => {
  const cases = [
    { version: 'gae', book: '*시*' },
    { version: 'sae', book: '*시*' },
    { version: 'en', book: '19_Ps*' },
  ]

  for (const { version, book } of cases) {
    const full = chapterText(version, book, 1)
    assert.deepEqual(markersOf(sliceVerses(full, [{ from: 2, to: 3 }])), ['2', '3'], version)
    assert.deepEqual(markersOf(sliceVerses(full, [{ from: 5, to: 5 }])), ['5'], version)
  }
})

test('본문이 사라질 상황에서는 원본을 그대로 돌려준다', () => {
  const full = chapterText('gae', '*시*', 1)

  // 절 마커가 아예 없는 본문
  const noMarker = '마커가 없는 스캔 전사본 문단이다.'
  assert.equal(sliceVerses(noMarker, [{ from: 1, to: 3 }]), noMarker)

  // 요청 범위가 본문 절 수를 벗어나 겹치는 문단이 하나도 없을 때
  assert.equal(sliceVerses(full, [{ from: 90, to: 99 }]), full)

  // 범위가 비었을 때 (verseLabel 없음과 같은 경로)
  assert.equal(sliceVerses(full, []), full)
})

test('표기가 가리키는 장이 본문 범위 밖이면 그 장은 걸리지 않는다', () => {
  // 실제 등록 데이터: {book: 마가복음, chapter: 1, verseLabel: '5:17-18'}
  const ranges = parseVerseLabel('5:17-18', 1)
  assert.equal(ranges.get(1), undefined)
  assert.deepEqual(ranges.get(5), [{ from: 17, to: 18 }])
})

test('자른 본문의 형광펜 키가 장 전체일 때와 같다', async () => {
  // verseKey가 바뀌면 이미 칠해둔 하이라이트가 orphan이 된다 — 절 마커가 붙은 문단은 유지되어야 한다
  const { splitBlocks } = await server.ssrLoadModule('/src/passageBlocks.ts')
  const full = chapterText('gae', '*시*', 1)

  const keyOf = (text) =>
    splitBlocks([{ label: '시편 1편', text }], 1)
      .filter((block) => block.type === 'segment')
      .map((block) => block.verseKey)

  const fullKeys = keyOf(full)
  const slicedKeys = keyOf(sliceVerses(full, [{ from: 2, to: 3 }]))

  assert.deepEqual(slicedKeys, ['1:2', '1:3'])
  for (const key of slicedKeys) assert.ok(fullKeys.includes(key), key)
})
