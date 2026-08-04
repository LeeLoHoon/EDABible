/* 설교 본문 참조 → 실제 성경 본문 조각.
   BiblePicker는 고르는 UI라 화면이 필요하지만, 묵상 화면은 관리자가 이미 정해둔 본문을
   그냥 읽기만 하므로 같은 조각 조립을 UI 없이 수행한다. 조각 시퀀스를 BiblePicker와
   똑같이 맞춰야 PassageText가 만드는 형광펜 키가 두 앱에서 같은 규칙으로 나온다. */

import { chapterLabel, chapterTextAt, loadBook, loadIndex, type BookDoc } from './bible'
import type { PassageChunk } from './components/BiblePicker'
import type { Sermon, SermonPassage } from './db'
import { EN_BOOK_NAMES, KO_BOOK_NAMES, bookOrderByName } from './i18n/bibleBookNames'
import { getLang, type Lang } from './i18n/lang'
import { parseVerseLabel, sliceVerses } from './verseRange'

/** 설교 목록 경로 — 단독 배포는 앱 루트, 통합(all) 배포는 /sermon 아래에 산다 */
export const SERMON_LIST_PATH = __APP_TARGET__ === 'all' ? '/sermon' : '/'

function translatedBookName(book: string, lang: Lang): string {
  const order = bookOrderByName(book)
  if (order === null) return book
  return (lang === 'en' ? EN_BOOK_NAMES : KO_BOOK_NAMES)[order - 1] ?? book
}

function localizedField(korean: string, english: string | undefined, lang: Lang): string {
  if (lang === 'en' && english?.trim()) return english
  return korean
}

/** 번역이 비어 있으면 원문(한국어)을 그대로 사용하며 번역문을 만들어내지 않는다. */
export function localizedSermonTitle(sermon: Sermon, lang: Lang): string {
  return localizedField(sermon.title, sermon.titleEn, lang)
}

export function localizedSermonPreacher(sermon: Sermon, lang: Lang): string {
  return localizedField(sermon.preacher, sermon.preacherEn, lang)
}

export function localizedSermonSummary(sermon: Sermon, lang: Lang): string {
  return localizedField(sermon.summary, sermon.summaryEn, lang)
}

/** 영어 point가 빠진 위치만 같은 index의 한국어 point로 fallback한다. */
export function localizedSermonPoints(sermon: Sermon, lang: Lang): string[] {
  if (lang === 'ko') return [...sermon.points]
  const english = sermon.pointsEn ?? []
  return sermon.points.map((point, index) => (english[index]?.trim() ? english[index] : point))
}

export function localizedSermonPassage(passage: SermonPassage, lang: Lang): SermonPassage {
  return { ...passage, book: translatedBookName(passage.book, lang) }
}

export function localizedSermonPassageLabel(passage: SermonPassage, lang: Lang): string {
  const localized = localizedSermonPassage(passage, lang)
  if (localized.verseLabel) return `${localized.book} ${localized.verseLabel}`
  if (lang === 'en') {
    return localized.endChapter !== localized.chapter
      ? `${localized.book} ${localized.chapter}-${localized.endChapter}`
      : `${localized.book} ${localized.chapter}`
  }
  const unit = localized.book === '시편' ? '편' : '장'
  return localized.endChapter !== localized.chapter
    ? `${localized.book} ${localized.chapter}~${localized.endChapter}${unit}`
    : `${localized.book} ${localized.chapter}${unit}`
}

/** 관리자가 절 범위를 적었으면 그대로 쓰고, 아니면 장 단위 참조로 표기한다 */
export function sermonPassageLabel(passage: SermonPassage): string {
  return localizedSermonPassageLabel(passage, getLang())
}

export function sermonPassagesLabel(passages: readonly SermonPassage[]): string {
  return passages.map(sermonPassageLabel).join(', ')
}

export interface SermonPassageText {
  ref: string
  chunks: PassageChunk[]
  /** 형광펜 키의 장 카운터 시작점 — PassageText의 startChapter로 그대로 넘긴다 */
  startChapter: number
}

export async function loadSermonPassages(
  passages: readonly SermonPassage[],
): Promise<SermonPassageText> {
  const ref = sermonPassagesLabel(passages)
  if (passages.length === 0) return { ref, chunks: [], startChapter: 1 }

  const index = await loadIndex()
  const metaFor = (book: string) =>
    index.find((item) => item.book === book) ??
    index.find((item) => item.order === bookOrderByName(book))

  const files = [...new Set(passages.map((passage) => metaFor(passage.book)?.file).filter((file): file is string => !!file))]
  const docByFile = new Map<string, BookDoc>()
  await Promise.all(
    files.map(async (file) => {
      docByFile.set(file, await loadBook(file))
    }),
  )

  const chunks: PassageChunk[] = []
  for (const passage of passages) {
    const meta = metaFor(passage.book)
    const doc = meta ? docByFile.get(meta.file) : undefined
    const book = doc?.book ?? meta?.book ?? passage.book
    // 관리자가 절 범위를 적었으면 그 절만 묵상에 띄운다. 표기가 가리키는 장이
    // 이 본문 범위 밖이면(잘못 입력) 해당 장은 걸리지 않아 장 전체가 그대로 남는다.
    const wantedByChapter = parseVerseLabel(passage.verseLabel, passage.chapter)

    const own: PassageChunk[] = []
    for (let current = passage.chapter; current <= passage.endChapter; current += 1) {
      const full = doc ? chapterTextAt(doc, current) : ''
      const wanted = wantedByChapter.get(current)
      const text = wanted ? sliceVerses(full, wanted) : full
      if (text) own.push({ label: chapterLabel(book, current), text })
    }
    if (own.length === 0) continue

    // 본문이 여러 개면 어느 구절인지 알 수 있게 참조 줄을 앞에 끼운다 (BiblePicker와 같은 순서)
    if (passages.length > 1) chunks.push({ label: null, text: sermonPassageLabel(passage) })
    chunks.push(...own)
  }

  return { ref, chunks, startChapter: passages[0].chapter }
}
