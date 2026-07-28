import assert from 'node:assert/strict'
import test from 'node:test'
import {
  binderVideos,
  currentVideoStage,
  lessonVideoBeforePage,
  videoStagesFor,
  YOUTUBE_ID_RE,
} from './binder_videos.mjs'

const timothyStages = binderVideos['spl-timothy']
const timothyLessons = timothyStages.flatMap((stage) => stage.lessons)

test('등록된 세트의 영상 단계만 안전하게 반환한다', () => {
  assert.ok(Array.isArray(videoStagesFor('spl-timothy')))
  assert.equal(videoStagesFor('__proto__'), undefined)
  assert.equal(videoStagesFor('constructor'), undefined)
  assert.equal(videoStagesFor('spl-timothy-en'), undefined)
})

test('디모데 만들기 영상 ID는 형식이 맞고 세트 안에서 중복되지 않는다', () => {
  const videoIds = timothyLessons.map((lesson) => lesson.videoId)

  for (const videoId of videoIds) {
    assert.match(videoId, YOUTUBE_ID_RE)
  }
  assert.equal(new Set(videoIds).size, videoIds.length)
})

test('디모데 만들기 영상 단계와 과 번호가 완전하고 쪽 순서가 맞다', () => {
  assert.equal(timothyStages.length, 18)
  assert.equal(timothyLessons.length, 72)
  assert.deepEqual(
    timothyStages.map((stage) => stage.stage),
    Array.from({ length: 18 }, (_, index) => String(index + 1).padStart(2, '0')),
  )
  assert.deepEqual(
    timothyLessons.map((lesson) => lesson.no),
    Array.from({ length: 72 }, (_, index) => index + 1),
  )
  assert.equal(timothyStages[0].page, 3)
  assert.equal(timothyStages.at(-1).page, 207)
  assert.ok(timothyStages.every((stage) => stage.page <= 216))
  assert.ok(
    timothyStages.every((stage, index) => index === 0 || timothyStages[index - 1].page < stage.page),
  )
})

test('모든 과의 느낀점 쪽이 공식과 일치하고 중복 없이 증가한다', () => {
  for (const stage of timothyStages) {
    for (const lesson of stage.lessons) {
      assert.equal(lesson.page, stage.page + 1 + 2 * ((lesson.no - 1) % 4))
    }
  }

  const pages = timothyLessons.map((lesson) => lesson.page)
  assert.equal(new Set(pages).size, pages.length)
  assert.ok(pages.every((page, index) => index === 0 || pages[index - 1] < page))
  assert.ok(pages.every((page) => page <= 216))
})

test('현재 쪽에 해당하는 영상 단계를 판정한다', () => {
  assert.equal(currentVideoStage('spl-timothy', 1)?.stage, '01')
  assert.equal(currentVideoStage('spl-timothy', 3)?.stage, '01')
  assert.equal(currentVideoStage('spl-timothy', 14)?.stage, '01')
  assert.equal(currentVideoStage('spl-timothy', 15)?.stage, '02')
  assert.equal(currentVideoStage('spl-timothy', 216)?.stage, '18')
  assert.equal(currentVideoStage('spl-timothy-en', 1), undefined)
  assert.equal(currentVideoStage('__proto__', 1), undefined)
})

test('느낀점 쪽 바로 앞에 표시할 영상 과를 찾는다', () => {
  assert.equal(lessonVideoBeforePage('spl-timothy', 4)?.lesson.no, 1)
  assert.equal(lessonVideoBeforePage('spl-timothy', 16)?.lesson.no, 5)
  assert.equal(lessonVideoBeforePage('spl-timothy', 214)?.lesson.no, 72)
  assert.equal(lessonVideoBeforePage('spl-timothy', 3), undefined)
  assert.equal(lessonVideoBeforePage('spl-timothy', 5), undefined)
  assert.equal(lessonVideoBeforePage('spl-timothy-en', 4), undefined)
})
