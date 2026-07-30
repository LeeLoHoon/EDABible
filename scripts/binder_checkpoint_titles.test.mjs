import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { binderCheckpointTitles, checkpointTitle } from './binder_checkpoint_titles.mjs'
import {
  buildCheckpointTitleReport,
  titleCandidatesForCheckpoint,
  validateCheckpointTitleMetadata,
} from './check_binder_checkpoint_titles.mjs'

const sets = JSON.parse(await readFile(new URL('./binder-sets.json', import.meta.url), 'utf8'))

test('checkpointTitle은 요청 언어 다음에 한국어로 fallback한다', () => {
  const original = binderCheckpointTitles['spl-timothy']['issue-02']
  binderCheckpointTitles['spl-timothy']['issue-02'] = { ko: '승인된 제목', en: 'Approved title' }
  try {
    assert.equal(checkpointTitle('spl-timothy', 'issue-02', 'en'), 'Approved title')
    assert.equal(checkpointTitle('spl-timothy', 'issue-02', 'ko'), '승인된 제목')
    delete binderCheckpointTitles['spl-timothy']['issue-02'].en
    assert.equal(checkpointTitle('spl-timothy', 'issue-02', 'en'), '승인된 제목')
  } finally {
    if (original) binderCheckpointTitles['spl-timothy']['issue-02'] = original
    else delete binderCheckpointTitles['spl-timothy']['issue-02']
  }
})

test('알 수 없는 set과 checkpoint는 undefined를 반환한다', () => {
  assert.equal(checkpointTitle('spl-bookstudy', 'issue-99', 'ko'), undefined)
  assert.equal(checkpointTitle('__proto__', 'issue-02', 'ko'), undefined)
  assert.equal(checkpointTitle('spl-timothy', 'constructor', 'ko'), undefined)
})

test('승인된 source label과 영상 제목 후보를 구분한다', () => {
  const candidates = titleCandidatesForCheckpoint('spl-timothy', 'issue-02')
  assert.ok(candidates.includes('2-2. 박효진 장로님 - 사랑은 허다한 죄를'))
  assert.equal(
    checkpointTitle('spl-timothy', 'issue-02', 'ko'),
    '사랑은 허다한 죄를 → 성령님은 누구신가',
  )

  const report = buildCheckpointTitleReport(sets)
  assert.equal(report.length, 0)
})

test('metadata key와 언어는 네 set의 생성된 checkpoint를 정확히 포함한다', () => {
  for (const setId of [
    'spl-timothy',
    'spl-bookstudy',
    'spl-timothy-en',
    'spl-bookstudy-en',
  ]) {
    const set = sets.find((candidate) => candidate.id === setId)
    assert.ok(set)

    assert.deepEqual(
      Object.keys(binderCheckpointTitles[setId]).sort(),
      set.checkpoints.map((checkpoint) => checkpoint.id).sort(),
    )

    const lang = setId.endsWith('-en') ? 'en' : 'ko'
    for (const checkpoint of set.checkpoints) {
      const localized = binderCheckpointTitles[setId][checkpoint.id]
      assert.deepEqual(Object.keys(localized), [lang])
      assert.ok(localized[lang].trim())
      assert.equal(checkpointTitle(setId, checkpoint.id, lang), localized[lang])
    }
  }

  assert.ok(Object.hasOwn(binderCheckpointTitles['spl-timothy'], 'issue-00-01'))
  assert.ok(Object.hasOwn(binderCheckpointTitles['spl-bookstudy'], 'issue-00-01'))
  assert.ok(!Object.hasOwn(binderCheckpointTitles['spl-timothy-en'], 'issue-00-01'))
  assert.ok(!Object.hasOwn(binderCheckpointTitles['spl-bookstudy-en'], 'issue-00-01'))
  assert.deepEqual(validateCheckpointTitleMetadata(sets), [])
})

test('영문 set은 PDF에서 승인된 영문 title을 사용한다', () => {
  assert.equal(
    checkpointTitle('spl-timothy-en', 'issue-02', 'en'),
    'Love Covers a Multitude of Sins → Who Is the Holy Spirit?',
  )
  assert.equal(
    checkpointTitle('spl-bookstudy-en', 'issue-03', 'en'),
    'Making Life Work, Lessons 1-2 → Making Life Work, Lessons 5-6',
  )
})
