import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  legacyBinderBooks,
  legacyPageToSet,
  migrateLegacyWorks,
} from './binder_legacy_map.mjs'

async function loadSets() {
  try {
    return JSON.parse(await readFile(new URL('./binder-sets.json', import.meta.url), 'utf8'))
  } catch (error) {
    throw new Error('scripts/binder-sets.json이 없습니다. 세트 생성 완료 후 테스트를 다시 실행하세요.', {
      cause: error,
    })
  }
}

const sets = await loadSets()

function work(bookId, patch = {}) {
  return {
    bookId,
    transcription: { mode: 'text', text: '', strokes: [] },
    notes: { mode: 'text', text: '', strokes: [] },
    pageInputs: {},
    pageTextBoxes: {},
    bookmarks: [],
    checkpointPages: {},
    updatedAt: 1,
    ...patch,
  }
}

test('U1: 00-01 새신자 구간은 항등 매핑한다', () => {
  assert.deepEqual(legacyPageToSet('spl-00-01', 1, sets), { setId: 'spl-starter', page: 1 })
  assert.deepEqual(legacyPageToSet('spl-00-01', 112, sets), { setId: 'spl-starter', page: 112 })
})

test('U2: 00-01 묵상 구간을 매핑한다', () => {
  assert.deepEqual(legacyPageToSet('spl-00-01', 113, sets), { setId: 'spl-meditation', page: 1 })
  assert.deepEqual(legacyPageToSet('spl-00-01', 150, sets), { setId: 'spl-meditation', page: 38 })
})

test('U3: 00-01 디모데 구간을 매핑한다', () => {
  assert.deepEqual(legacyPageToSet('spl-00-01', 151, sets), { setId: 'spl-timothy', page: 1 })
  assert.deepEqual(legacyPageToSet('spl-00-01', 162, sets), { setId: 'spl-timothy', page: 12 })
})

test('U4: 00-01 책공부 구간을 매핑한다', () => {
  assert.deepEqual(legacyPageToSet('spl-00-01', 163, sets), { setId: 'spl-bookstudy', page: 1 })
  assert.deepEqual(legacyPageToSet('spl-00-01', 172, sets), { setId: 'spl-bookstudy', page: 10 })
})

test('U5: 일반 회차의 표지와 목차는 직접 매핑하지 않는다', () => {
  for (let page = 1; page <= 6; page += 1) assert.equal(legacyPageToSet('spl-02', page, sets), null)
})

test('U6: 02호 묵상 구간을 checkpoint에 이어 붙인다', () => {
  assert.deepEqual(legacyPageToSet('spl-02', 7, sets), { setId: 'spl-meditation', page: 39 })
  assert.deepEqual(legacyPageToSet('spl-02', 42, sets), { setId: 'spl-meditation', page: 74 })
})

test('U7: 02호 디모데 구간을 checkpoint에 이어 붙인다', () => {
  assert.deepEqual(legacyPageToSet('spl-02', 43, sets), { setId: 'spl-timothy', page: 13 })
  assert.deepEqual(legacyPageToSet('spl-02', 54, sets), { setId: 'spl-timothy', page: 24 })
})

test('U8: 02호 책공부 구간을 checkpoint에 이어 붙인다', () => {
  assert.deepEqual(legacyPageToSet('spl-02', 55, sets), { setId: 'spl-bookstudy', page: 11 })
  assert.deepEqual(legacyPageToSet('spl-02', 64, sets), { setId: 'spl-bookstudy', page: 20 })
})

test('U9: 영문 회차는 영문 세트에 매핑한다', () => {
  assert.deepEqual(legacyPageToSet('spl-02-en', 7, sets), { setId: 'spl-meditation-en', page: 1 })
})

test('U10: 범위 밖 쪽과 모르는 권은 매핑하지 않는다', () => {
  assert.equal(legacyPageToSet('spl-02', 0, sets), null)
  assert.equal(legacyPageToSet('spl-02', 65, sets), null)
  assert.equal(legacyPageToSet('spl-unknown', 7, sets), null)
})

test('U11: ko/en 모든 원본 쪽은 세트별 1..pages에 구멍과 중복 없이 전단사다', () => {
  const reached = new Map(sets.map((set) => [set.id, new Set()]))
  for (const book of legacyBinderBooks) {
    const firstPage = book.issue === '00-01' ? 1 : 7
    for (let page = firstPage; page <= book.pages; page += 1) {
      const mapped = legacyPageToSet(book.id, page, sets)
      assert.ok(mapped, `${book.id} ${page}쪽이 매핑되지 않았습니다.`)
      const pages = reached.get(mapped.setId)
      assert.ok(pages, `${mapped.setId} 세트가 없습니다.`)
      assert.equal(pages.has(mapped.page), false, `${mapped.setId} ${mapped.page}쪽이 중복됩니다.`)
      pages.add(mapped.page)
    }
  }

  for (const set of sets) {
    const pages = reached.get(set.id)
    assert.equal(pages.size, set.pages, `${set.id} 도달 쪽 수가 일치하지 않습니다.`)
    for (let page = 1; page <= set.pages; page += 1) {
      assert.equal(pages.has(page), true, `${set.id} ${page}쪽이 비어 있습니다.`)
    }
  }
})

test('U12: 마이그레이션을 두 번 적용해도 결과가 같다', () => {
  const input = [
    work('spl-02', {
      pageInputs: { 7: { mode: 'text', text: 'memo', strokes: [] } },
      pageTextBoxes: { 43: [{ id: 'box', x: 0, y: 0, width: 0.5, text: 'text' }] },
      bookmarks: [{ id: 'bookmark', page: 1, label: 'cover', createdAt: 1 }],
      lastPageNumber: 55,
      checkpointPages: { legacy: 43 },
    }),
  ]
  const once = migrateLegacyWorks(input, sets)
  assert.deepEqual(migrateLegacyWorks(once, sets), once)
})

test('U13: 책갈피 UUID를 보존하고 표지 책갈피에 접미사를 붙인다', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  const migrated = migrateLegacyWorks(
    [work('spl-02', { bookmarks: [{ id, page: 1, label: '표지', createdAt: 1 }] })],
    sets,
  )
  const bookmark = migrated.flatMap((item) => item.bookmarks).find((item) => item.id === id)
  assert.ok(bookmark)
  assert.equal(bookmark.id, id)
  assert.equal(bookmark.label, '표지 (구 표지·목차)')
})
