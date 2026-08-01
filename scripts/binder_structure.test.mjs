import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import { binderCheckpoints, checkpointsFor } from './binder_checkpoints.mjs'
import { binderTextLayouts, binderTextPresetPages, textPresetsFor } from './binder_text_presets.mjs'

const sets = JSON.parse(await readFile(new URL('./binder-sets.json', import.meta.url), 'utf8'))
const pagesOf = (setId) => sets.find((set) => set.id === setId)?.pages ?? 0

test('실측 체크포인트는 세트 쪽 범위 안에서 오름차순이다', () => {
  for (const [setId, checkpoints] of Object.entries(binderCheckpoints)) {
    const pageCount = pagesOf(setId)
    assert.ok(pageCount > 0, `${setId} 세트를 binder-sets.json에서 찾지 못했습니다`)
    assert.ok(checkpoints.length > 0, `${setId} 체크포인트가 비어 있습니다`)

    let previousPage = 0
    const ids = new Set()
    for (const checkpoint of checkpoints) {
      assert.ok(
        Number.isInteger(checkpoint.page) && checkpoint.page >= 1 && checkpoint.page <= pageCount,
        `${setId} ${checkpoint.id} 쪽(${checkpoint.page})이 1~${pageCount} 밖입니다`,
      )
      assert.ok(
        checkpoint.page > previousPage,
        `${setId} ${checkpoint.id} 쪽이 앞 체크포인트보다 앞섭니다`,
      )
      assert.ok(checkpoint.label.trim().length > 0, `${setId} ${checkpoint.id} 라벨이 비었습니다`)
      assert.ok(!ids.has(checkpoint.id), `${setId} ${checkpoint.id}가 중복입니다`)
      ids.add(checkpoint.id)
      previousPage = checkpoint.page
    }
  }
})

test('성경묵상 체크포인트는 3쪽 성경묵상 순서를 따른다', () => {
  const labels = checkpointsFor('spl-meditation').map((checkpoint) => checkpoint.label)
  assert.deepEqual(labels, [
    '잠언 & 전도서',
    '시편',
    '요한복음',
    '사도행전',
    '잠언 & 전도서 (각 2장)',
    '시편',
    '창세기',
    '출애굽기',
    '여호수아',
    '사무엘상',
  ])
})

test('디모데·책공부 체크포인트는 순서 쪽의 대제목과 책 단위다', () => {
  const timothy = checkpointsFor('spl-timothy')
  assert.equal(timothy[0].label, '1. 김기동 목사님 - 고구마 전도왕')
  assert.equal(timothy.at(-1).label, '10. 이재철 목사님 - 사명자반')

  const bookStudy = checkpointsFor('spl-bookstudy').map((checkpoint) => checkpoint.label)
  assert.equal(bookStudy[0], '구원')
  assert.ok(bookStudy.includes('대적기도'))
  assert.equal(bookStudy.at(-1), '하루만에 꿰뚫는 기독교 역사')
  // 같은 책이 여러 호에 걸쳐도 체크포인트는 책마다 하나다
  assert.equal(new Set(bookStudy).size, bookStudy.length)
})

test('알 수 없는 세트는 체크포인트가 없다', () => {
  assert.equal(checkpointsFor('spl-starter'), null)
  assert.equal(checkpointsFor('nope'), null)
})

test('기본 입력칸 좌표는 쪽 안에 들어간다', () => {
  for (const [layoutId, boxes] of Object.entries(binderTextLayouts)) {
    assert.ok(boxes.length > 0, `${layoutId} 배치가 비었습니다`)
    const ids = new Set()
    for (const box of boxes) {
      assert.ok(!ids.has(box.id), `${layoutId} ${box.id}가 중복입니다`)
      ids.add(box.id)
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(box[key] > 0 && box[key] <= 1, `${layoutId} ${box.id} ${key}=${box[key]}`)
      }
      assert.ok(box.x + box.width <= 1, `${layoutId} ${box.id}가 오른쪽으로 넘칩니다`)
      assert.ok(box.y + box.height <= 1, `${layoutId} ${box.id}가 아래로 넘칩니다`)
    }
  }
})

test('기본 입력칸이 놓이는 쪽은 세트 쪽 범위 안이다', () => {
  for (const [setId, byLayout] of Object.entries(binderTextPresetPages)) {
    const pageCount = pagesOf(setId)
    const seen = new Set()
    for (const [layoutId, pages] of Object.entries(byLayout)) {
      assert.ok(binderTextLayouts[layoutId], `${setId}의 ${layoutId} 배치가 없습니다`)
      for (const page of pages) {
        assert.ok(page >= 1 && page <= pageCount, `${setId} ${page}쪽이 범위 밖입니다`)
        assert.ok(!seen.has(page), `${setId} ${page}쪽에 배치가 둘 이상입니다`)
        seen.add(page)
      }
    }
  }
})

test('성경묵상 필기 쪽에는 묵상 3칸과 배우자 기도 칸이 블록마다 놓인다', () => {
  const boxes = textPresetsFor('spl-meditation', 6)
  assert.equal(boxes.length, 8)
  assert.equal(boxes.filter((box) => box.id.startsWith('note-')).length, 6)
  assert.equal(boxes.filter((box) => box.id.startsWith('spouse-')).length, 2)
  // 위에서 아래로 겹치지 않게 놓인다
  const sorted = [...boxes].sort((a, b) => a.y - b.y)
  for (const [index, box] of sorted.entries()) {
    if (index === 0) continue
    const previous = sorted[index - 1]
    assert.ok(previous.y + previous.height <= box.y + 0.001, `${previous.id}와 ${box.id}가 겹칩니다`)
  }
})

test('디모데·책공부 괘선 쪽은 인쇄된 줄을 가리는 큰 칸 하나다', () => {
  for (const setId of ['spl-timothy', 'spl-bookstudy']) {
    const titled = textPresetsFor(setId, 4)
    assert.equal(titled.length, 1)
    assert.equal(titled[0].opaque, true)
    assert.ok(titled[0].height > 0.7, '괘선을 덮을 만큼 크지 않습니다')
  }
  // 표지·순서 쪽에는 기본 칸을 두지 않는다
  assert.deepEqual(textPresetsFor('spl-timothy', 3), [])
})
