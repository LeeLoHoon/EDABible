/** 메시지 성경 로더. IndexedDB 캐시를 우선 사용하고, 없으면 public/bible/ 에서 가져온다. */

import { db } from './db'
import { finalizeRemoteChapter, loadRemoteBook, saveRemoteChapterText } from './remoteBible'

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
      let doc: BookDoc

      if (cached?.build === BUILD && cached.doc) {
        doc = cached.doc as BookDoc
      } else {
        doc = await fetchJson<BookDoc>(`${BASE}bible/${file}?v=${BUILD}`, '본문을 불러오지 못했습니다')
        await db.bibleBooks.put({
          file,
          build: BUILD,
          doc,
          updatedAt: new Date().toISOString(),
        })
      }

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

      return doc
    })()
    bookCache.set(file, p)
  }
  return p
}

export async function saveBibleChapterText(file: string, chapter: number, text: string): Promise<BookDoc> {
  const doc = await loadBook(file)
  const existing = doc.chapters.find((item) => item.chapter === chapter)
  const previousText = existing?.text ?? ''

  if (existing?.isFinalized) {
    throw new Error('완료된 장은 수정할 수 없습니다')
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
  const doc = await loadBook(file)
  const existing = doc.chapters.find((item) => item.chapter === chapter)

  if (!existing) {
    throw new Error('완료할 본문을 찾지 못했습니다')
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
