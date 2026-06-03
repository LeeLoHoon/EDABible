/** 메시지 성경(권별 JSON) 로더. public/bible/ 에서 fetch, 메모리 캐시. */

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

// Vite base('/EDABible/') 기준 — GitHub Pages 서브경로 대응
const BASE = import.meta.env.BASE_URL

let indexCache: Promise<BookMeta[]> | null = null
const bookCache = new Map<string, Promise<BookDoc>>()

export function loadIndex(): Promise<BookMeta[]> {
  if (!indexCache) {
    indexCache = fetch(`${BASE}bible/index.json`).then((r) => {
      if (!r.ok) throw new Error('성경 목록을 불러오지 못했습니다')
      return r.json()
    })
  }
  return indexCache
}

export function loadBook(file: string): Promise<BookDoc> {
  let p = bookCache.get(file)
  if (!p) {
    p = fetch(`${BASE}bible/${file}`).then((r) => {
      if (!r.ok) throw new Error('본문을 불러오지 못했습니다')
      return r.json()
    })
    bookCache.set(file, p)
  }
  return p
}

/** 'YYYY' 형태가 아니라 '창세기 3장' 같은 참조 문자열을 만든다. */
export function makeRef(book: string, chapter: number): string {
  return `${book} ${chapter}장`
}

/** 'creation 3장' 같은 bibleRef에서 책 이름과 장을 best-effort로 파싱. */
export function parseRef(ref: string): { book: string; chapter: number } | null {
  if (!ref) return null
  const m = ref.match(/^(.+?)\s*(\d+)\s*장?$/)
  if (!m) return null
  return { book: m[1].trim(), chapter: Number(m[2]) }
}
