/** 메시지 성경 로더. IndexedDB 캐시를 우선 사용하고, 없으면 public/bible/ 에서 가져온다. */

import { db } from './db'

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
}

export interface BookDoc {
  order: number
  book: string
  abbr: string
  chapters: Chapter[]
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

async function fetchJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(message)
  return response.json()
}

export function loadIndex(): Promise<BookMeta[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const cached = await db.bibleIndex.get('index')
      if (cached?.build === BUILD && Array.isArray(cached.items)) {
        return cached.items as BookMeta[]
      }

      const items = await fetchJson<BookMeta[]>(`${BASE}bible/index.json?v=${BUILD}`, '성경 목록을 불러오지 못했습니다')
      await db.bibleIndex.put({
        id: 'index',
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
  let p = bookCache.get(file)
  if (!p) {
    p = (async () => {
      const cached = await db.bibleBooks.get(file)
      if (cached?.build === BUILD && cached.doc) {
        return cached.doc as BookDoc
      }

      const doc = await fetchJson<BookDoc>(`${BASE}bible/${file}?v=${BUILD}`, '본문을 불러오지 못했습니다')
      await db.bibleBooks.put({
        file,
        build: BUILD,
        doc,
        updatedAt: new Date().toISOString(),
      })
      return doc
    })()
    bookCache.set(file, p)
  }
  return p
}

export async function clearBibleCache(): Promise<void> {
  indexCache = null
  bookCache.clear()
  await db.transaction('rw', db.bibleIndex, db.bibleBooks, async () => {
    await db.bibleIndex.clear()
    await db.bibleBooks.clear()
  })
}

/** '창세기 3장', '잠언 1~2장' 같은 참조 문자열을 만든다. */
export function makeRef(book: string, chapter: number, endChapter?: number): string {
  if (endChapter && endChapter !== chapter) {
    return `${book} ${chapter}~${endChapter}장`
  }
  return `${book} ${chapter}장`
}

/** bibleRef 한 조각에서 책 이름과 장 범위를 best-effort로 파싱. */
export function parseRef(ref: string): PassageRef | null {
  if (!ref) return null
  const m = ref.match(/^(.+?)\s*(\d+)(?:\s*[~-]\s*(\d+))?\s*장?$/)
  if (!m) return null
  const chapter = Number(m[2])
  return { book: m[1].trim(), chapter, endChapter: Number(m[3] ?? chapter) }
}

/** '잠언 1~2장, 전도서 1~2장' 같은 여러 본문 참조를 파싱한다. */
export function parseRefs(refs: string): PassageRef[] {
  return refs
    .split(/[,，、]/)
    .map((ref) => parseRef(ref.trim()))
    .filter((ref): ref is PassageRef => !!ref)
}
