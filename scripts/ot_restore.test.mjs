import test from 'node:test'
import assert from 'node:assert/strict'

import {
  alignStreams,
  inverseIndex,
  locate,
  normalize,
  pickMarks,
  readJsonl,
  restoreChapter,
  snapToWord,
  verseCeilings,
  CHAPTERS_PATH,
  GAE_PATH,
} from './restore_ot_structure.mjs'

/* --------------------------------------------------------------- 단위 */

test('normalize는 한글만 남기고 원문 위치를 기억한다', () => {
  const { text, map } = normalize('(1-2) 빛! Light\n좋았다')
  assert.equal(text, '빛좋았다')
  assert.equal(map.length, text.length)
  assert.equal('(1-2) 빛! Light\n좋았다'[map[0]], '빛')
})

test('pickMarks는 겹치는 절 구간을 버리고 이어지는 쪽을 고른다', () => {
  const events = [
    { value: '1-2', at: 0, exact: true },
    { value: '3-10', at: 40, exact: true },
    { value: '2', at: 90, exact: false }, // 각주 번호 오인식
    { value: '11-19', at: 300, exact: true },
  ]
  assert.deepEqual(
    pickMarks(events, 26).map((mark) => mark.value),
    ['1-2', '3-10', '11-19'],
  )
})

test('pickMarks는 해당 장의 절 수를 넘는 번호를 버린다', () => {
  const events = [
    { value: '1', at: 0, exact: true },
    { value: '52', at: 50, exact: true }, // 페이지 번호가 절로 잡힌 경우
    { value: '5', at: 80, exact: true },
  ]
  assert.deepEqual(
    pickMarks(events, 10).map((mark) => mark.value),
    ['1', '5'],
  )
})

test('pickMarks는 너무 붙어 있는 후보를 하나로 본다', () => {
  const events = [
    { value: '1', at: 0, exact: true },
    { value: '2', at: 3, exact: true },
    { value: '9', at: 200, exact: true },
  ]
  assert.deepEqual(
    pickMarks(events, 20).map((mark) => mark.value),
    ['1', '9'],
  )
})

/* 어절 중간에 걸리는 것은 인쇄본이 그 어절을 줄 끝에서 끊어 절 번호가 뒷조각 앞에 찍힌
   경우다. 앞 절의 꼬리가 아니라 다음 절이 시작하는 자리이므로 뒤쪽 어절 머리를 먼저 본다. */
test('snapToWord는 어절 한가운데 마커가 박히지 않게 옮긴다', () => {
  const text = '살아서 무엇하겠는가? 저녁 식사로'
  assert.equal(snapToWord(text, 8), 12) // '무엇하겠는가?' 중간 → 다음 어절 머리로
  assert.equal(snapToWord(text, 4), 4) // 이미 어절 머리면 그대로
  assert.equal(snapToWord(text, 0), 0)
})

test('restoreChapter는 글자를 바꾸지 않고 절 마커만 얹는다', () => {
  const original = '욥이 자신의 운명을 저주하다.\n그러다 욥이 침묵을 깨뜨렸다.\n내가 태어난 날 사라져라.'
  const marks = [
    { value: '1-2', at: original.indexOf('그러다') },
    { value: '3-10', at: original.indexOf('내가') },
  ]
  const { text, heading } = restoreChapter(original, marks)

  assert.equal(heading, '욥이 자신의 운명을 저주하다')
  assert.deepEqual(text.split('\n'), [
    '[[욥이 자신의 운명을 저주하다]]',
    '(1-2) 그러다 욥이 침묵을 깨뜨렸다.',
    '(3-10) 내가 태어난 날 사라져라.',
  ])
  assert.equal(normalize(text).text, normalize(original).text)
})

test('restoreChapter는 이미 있는 [[소제목]]을 다시 감싸지 않는다', () => {
  const original = '[[끝이 가까이 왔다]]\n하나님의 말씀이 내게 임했다.\n재앙이다!'
  const marks = [
    { value: '1-4', at: original.indexOf('하나님의') },
    { value: '5-9', at: original.indexOf('재앙') },
  ]
  const { text } = restoreChapter(original, marks)

  assert.equal(text.split('\n')[0], '[[끝이 가까이 왔다]]')
  assert.ok(!text.includes('[[[['))
  assert.equal(normalize(text).text, normalize(original).text)
})

test('restoreChapter는 PDF 줄바꿈을 문단으로 다시 흘린다', () => {
  const original = '야곱과 함께 각자 자기 가족을 데리고\n이집트로 간 이스라엘의 아들들이다.'
  const { text } = restoreChapter(original, [{ value: '1-5', at: 0 }])
  assert.equal(text, '(1-5) 야곱과 함께 각자 자기 가족을 데리고 이집트로 간 이스라엘의 아들들이다.')
})

test('alignStreams와 locate는 OCR 오류가 섞여도 위치를 찾아낸다', () => {
  const app = '하나님께서 하늘과 땅을 창조하셨다 보이는 모든 것과 보이지 않는 모든 것을 창조하셨다'
  const ocr = app.replace('보이는', '보이늠') // OCR 오인식 한 곳
  const { anchors, coverage } = alignStreams(normalize(app).text, normalize(ocr).text)

  assert.ok(coverage > 0.6, `커버리지 ${coverage}`)
  const found = locate(anchors, inverseIndex(anchors), 0)
  assert.equal(found.at, 0)
  assert.equal(found.exact, true)
})

/* ------------------------------------------------------- 산출물 불변식 */

const VERSE_MARKER = /\((\d{1,3})(?:-(\d{1,3}))?\)/g

/* 이 파이프라인이 얹은 장(structure: 'restored')만 검사한다. 손대지 않은 옛 본문에는
   장 배정이 어긋난 곳이 따로 있어(예: 시편 11편에 119편 본문) 별도 과제로 남아 있다. */
test('복원한 장의 절 마커는 증가하고 개역개정 절 수를 넘지 않는다', async () => {
  const rows = (await readJsonl(CHAPTERS_PATH)).filter((row) => row.structure === 'restored')
  const ceilings = verseCeilings(await readJsonl(GAE_PATH))
  const problems = []

  for (const row of rows) {
    let previousEnd = 0
    for (const match of row.text.matchAll(VERSE_MARKER)) {
      const start = Number(match[1])
      const end = Number(match[2] ?? match[1])
      const ceiling = ceilings.get(`${row.book_order}:${row.chapter}`)
      if (end < start) problems.push(`${row.book} ${row.chapter}: 거꾸로 된 구간 ${match[0]}`)
      if (start <= previousEnd) problems.push(`${row.book} ${row.chapter}: 겹치는 구간 ${match[0]}`)
      if (ceiling && end > ceiling) problems.push(`${row.book} ${row.chapter}: 절 수 초과 ${match[0]}>${ceiling}`)
      previousEnd = end
    }
  }

  assert.deepEqual(problems.slice(0, 20), [])
})

test('본문에 겹친 소제목 괄호가 없다', async () => {
  const rows = await readJsonl(CHAPTERS_PATH)
  const broken = rows.filter((row) => row.text.includes('[[[[') || row.text.includes(']]]]'))
  assert.deepEqual(
    broken.map((row) => `${row.book} ${row.chapter}`),
    [],
  )
})
