/** 메시지 성경 로더. IndexedDB 캐시를 우선 사용하고, 없으면 public/bible/ 에서 가져온다. */

import { db } from './db'
import { getLang } from './i18n/lang'
import { t } from './i18n/strings'
import {
  finalizeRemoteChapter,
  loadRemoteBook,
  saveRemoteChapterText,
  unfinalizeRemoteChapter,
} from './remoteBible'

export interface BookMeta {
  order: number
  book: string
  abbr: string
  file: string
  chapters: number
  standardChapters: number
}

export interface Chapter {
  chapter: number
  text: string
  sourceQuality?: 'verified' | 'fallback'
  isFinalized?: boolean
}

export interface BookDoc {
  order: number
  book: string
  abbr: string
  chapters: Chapter[]
  supportsFinalize?: boolean
}

export interface PassageRef {
  book: string
  chapter: number
  endChapter: number
}

// Vite base('/EDABible/') 기준 — GitHub Pages 서브경로 대응
const BASE = import.meta.env.BASE_URL
const BUILD = __BUILD__

let indexCache: Promise<BookMeta[]> | null = null
const bookCache = new Map<string, Promise<BookDoc>>()

function bibleAssetKey(file: string): string {
  return getLang() === 'en' ? `en/${file}` : file
}

async function fetchJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(message)
  return response.json()
}

export function loadIndex(): Promise<BookMeta[]> {
  if (!indexCache) {
    // 언어 전환은 페이지 리로드를 동반하므로 메모리 캐시는 세션당 한 언어만 담는다.
    indexCache = (async () => {
      const id = getLang() === 'en' ? 'index:en' : 'index'
      const indexFile = bibleAssetKey('index.json')
      const cached = await db.bibleIndex.get(id)
      if (cached?.build === BUILD && Array.isArray(cached.items)) {
        return cached.items as BookMeta[]
      }

      const items = await fetchJson<BookMeta[]>(`${BASE}bible/${indexFile}?v=${BUILD}`, t('bibleIndexError'))
      await db.bibleIndex.put({
        id,
        build: BUILD,
        items,
        updatedAt: new Date().toISOString(),
      })
      return items
    })()
  }
  return indexCache
}

export function loadBook(file: string): Promise<BookDoc> {
  const key = bibleAssetKey(file)
  let p = bookCache.get(key)
  if (!p) {
    p = (async () => {
      const cached = await db.bibleBooks.get(key)
      let doc: BookDoc

      if (cached?.build === BUILD && cached.doc) {
        doc = cached.doc as BookDoc
      } else {
        doc = await fetchJson<BookDoc>(`${BASE}bible/${key}?v=${BUILD}`, t('bibleBookError'))
        await db.bibleBooks.put({
          file: key,
          build: BUILD,
          doc,
          updatedAt: new Date().toISOString(),
        })
      }

      if (getLang() === 'ko') {
        try {
          const remoteDoc = await loadRemoteBook(file, doc)
          if (remoteDoc) {
            await db.bibleBooks.put({
              file,
              build: BUILD,
              doc: remoteDoc,
              updatedAt: new Date().toISOString(),
            })
            return remoteDoc
          }
        } catch (error) {
          console.warn('Supabase Bible load failed; using local cache.', error)
        }
      }

      return doc
    })()
    bookCache.set(key, p)
  }
  return p
}

/** 장 본문을 꺼낸다. 한국어 스캔 원본의 창세기 28장만 장 번호가 비어 있어 첫 문장으로 찾는다. */
export function chapterTextAt(doc: BookDoc, chapter: number): string {
  const direct = doc.chapters.find((c) => c.chapter === chapter)?.text
  if (direct) return direct

  if (doc.book === '창세기' && chapter === 28) {
    return (
      doc.chapters.find((c) => c.text.includes('야곱은 브엘세바를 떠나 하란을 향해 갔다'))?.text ?? ''
    )
  }

  return ''
}

export async function saveBibleChapterText(file: string, chapter: number, text: string): Promise<BookDoc> {
  if (getLang() === 'en') throw new Error(t('bibleEditBlocked'))
  const doc = await loadBook(file)
  const existing = doc.chapters.find((item) => item.chapter === chapter)
  const previousText = existing?.text ?? ''

  if (existing?.isFinalized) {
    throw new Error(t('bibleFinalizedEditError'))
  }

  await saveRemoteChapterText({
    file,
    doc,
    chapter,
    previousText,
    nextText: text,
    build: BUILD,
  })

  const chapters = [...doc.chapters]
  const index = chapters.findIndex((item) => item.chapter === chapter)

  if (index >= 0) {
    chapters[index] = { ...chapters[index], text }
  } else {
    chapters.push({ chapter, text })
    chapters.sort((a, b) => a.chapter - b.chapter)
  }

  const nextDoc: BookDoc = { ...doc, chapters }
  await db.bibleBooks.put({
    file,
    build: BUILD,
    doc: nextDoc,
    updatedAt: new Date().toISOString(),
  })
  bookCache.set(file, Promise.resolve(nextDoc))
  return nextDoc
}

export async function finalizeBibleChapter(file: string, chapter: number): Promise<BookDoc> {
  if (getLang() === 'en') throw new Error(t('bibleEditBlocked'))
  const doc = await loadBook(file)
  const existing = doc.chapters.find((item) => item.chapter === chapter)

  if (!existing) {
    throw new Error(t('bibleFinalizeMissing'))
  }

  if (!existing.isFinalized) {
    await finalizeRemoteChapter({
      file,
      doc,
      chapter,
    })
  }

  const chapters = doc.chapters.map((item) =>
    item.chapter === chapter ? { ...item, isFinalized: true } : item,
  )
  const nextDoc: BookDoc = { ...doc, chapters }
  await db.bibleBooks.put({
    file,
    build: BUILD,
    doc: nextDoc,
    updatedAt: new Date().toISOString(),
  })
  bookCache.set(file, Promise.resolve(nextDoc))
  return nextDoc
}

/** 완료 처리를 되돌려 다시 수정할 수 있게 한다 (개발자 전용 경로). */
export async function unfinalizeBibleChapter(file: string, chapter: number): Promise<BookDoc> {
  if (getLang() === 'en') throw new Error(t('bibleEditBlocked'))
  const doc = await loadBook(file)
  const existing = doc.chapters.find((item) => item.chapter === chapter)

  if (!existing) {
    throw new Error(t('bibleUnfinalizeMissing'))
  }

  if (existing.isFinalized) {
    await unfinalizeRemoteChapter({ doc, chapter })
  }

  const chapters = doc.chapters.map((item) =>
    item.chapter === chapter ? { ...item, isFinalized: false } : item,
  )
  const nextDoc: BookDoc = { ...doc, chapters }
  await db.bibleBooks.put({
    file,
    build: BUILD,
    doc: nextDoc,
    updatedAt: new Date().toISOString(),
  })
  bookCache.set(file, Promise.resolve(nextDoc))
  return nextDoc
}

export async function clearBibleCache(): Promise<void> {
  indexCache = null
  bookCache.clear()
  await db.transaction('rw', db.bibleIndex, db.bibleBooks, async () => {
    await db.bibleIndex.clear()
    await db.bibleBooks.clear()
  })
}

export function chapterUnit(book?: string): string {
  if (getLang() === 'en') return ''
  return book === '시편' ? '편' : '장'
}

export function chapterLabel(book: string | undefined, chapter: number): string {
  if (getLang() === 'en') return book === 'Psalms' ? `Psalm ${chapter}` : `Ch. ${chapter}`
  return `${chapter}${chapterUnit(book)}`
}

/** '창세기 3장', '시편 1~2편' 같은 참조 문자열을 만든다. */
export function makeRef(book: string, chapter: number, endChapter?: number): string {
  if (getLang() === 'en') {
    return endChapter && endChapter !== chapter ? `${book} ${chapter}-${endChapter}` : `${book} ${chapter}`
  }
  const unit = chapterUnit(book)
  if (endChapter && endChapter !== chapter) {
    return `${book} ${chapter}~${endChapter}${unit}`
  }
  return `${book} ${chapter}${unit}`
}

/** 한국어와 영어 bibleRef 한 조각에서 책 이름과 장/편 범위를 best-effort로 파싱. */
export function parseRef(ref: string): PassageRef | null {
  if (!ref) return null
  const m = ref.match(/^(.+?)\s*(\d+)(?:\s*[~-]\s*(\d+))?\s*[장편]?$/)
  if (!m) return null
  const chapter = Number(m[2])
  return { book: m[1].trim(), chapter, endChapter: Number(m[3] ?? chapter) }
}

/** '잠언 1~2장, 시편 1~2편' 같은 여러 본문 참조를 파싱한다. */
export function parseRefs(refs: string): PassageRef[] {
  return refs
    .split(/[,，、]/)
    .map((ref) => parseRef(ref.trim()))
    .filter((ref): ref is PassageRef => !!ref)
}
