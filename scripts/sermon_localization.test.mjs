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
const sermonModule = await server.ssrLoadModule('/src/sermon.ts')

after(async () => {
  await server.close()
})

const sermon = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  service: 'morning',
  preachedOn: '2026-07-26',
  title: '한국어 제목',
  titleEn: 'English title',
  preacher: '한국어 설교자',
  preacherEn: '   ',
  passages: [{ book: '창세기', chapter: 1, endChapter: 1 }],
  summary: '한국어 요약',
  points: ['한국어 포인트 1', '한국어 포인트 2'],
  pointsEn: ['English point 1', ''],
  mediaUrl: '',
  published: true,
  updatedAt: 1,
}

test('영문 설교 metadata는 field/point별로 한국어 fallback하고 번역을 만들지 않는다', () => {
  assert.equal(sermonModule.localizedSermonTitle(sermon, 'en'), 'English title')
  assert.equal(sermonModule.localizedSermonPreacher(sermon, 'en'), '한국어 설교자')
  assert.equal(sermonModule.localizedSermonSummary(sermon, 'en'), '한국어 요약')
  assert.deepEqual(sermonModule.localizedSermonPoints(sermon, 'en'), [
    'English point 1',
    '한국어 포인트 2',
  ])
  assert.deepEqual(sermonModule.localizedSermonPoints(sermon, 'ko'), sermon.points)
})

test('한국어 point 개수와 순서가 authoritative하며 남는 영문 point를 노출하지 않는다', () => {
  assert.deepEqual(
    sermonModule.localizedSermonPoints(
      { ...sermon, pointsEn: ['English point 1', 'English point 2', 'Extra English point'] },
      'en',
    ),
    ['English point 1', 'English point 2'],
  )
})

test('본문 책 이름은 기존 66권 mapping만 사용하고 모르는 이름은 보존한다', () => {
  assert.equal(
    sermonModule.localizedSermonPassageLabel(
      { book: '창세기', chapter: 1, endChapter: 2 },
      'en',
    ),
    'Genesis 1-2',
  )
  assert.equal(
    sermonModule.localizedSermonPassageLabel(
      { book: 'Genesis', chapter: 1, endChapter: 1 },
      'ko',
    ),
    '창세기 1장',
  )
  assert.equal(
    sermonModule.localizedSermonPassageLabel(
      { book: '승인되지 않은 책 이름', chapter: 1, endChapter: 1 },
      'en',
    ),
    '승인되지 않은 책 이름 1',
  )
})
