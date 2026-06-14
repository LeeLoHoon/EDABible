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

export interface PassageRef {
  book: string
  chapter: number
  endChapter: number
}

// Vite base('/EDABible/') 기준 — GitHub Pages 서브경로 대응
const BASE = import.meta.env.BASE_URL

let indexCache: Promise<BookMeta[]> | null = null
const bookCache = new Map<string, Promise<BookDoc>>()

export function loadIndex(): Promise<BookMeta[]> {
  if (!indexCache) {
    indexCache = fetch(`${BASE}bible/index.json?v=${__BUILD__}`).then((r) => {
      if (!r.ok) throw new Error('성경 목록을 불러오지 못했습니다')
      return r.json()
    })
  }
  return indexCache
}

export function loadBook(file: string): Promise<BookDoc> {
  let p = bookCache.get(file)
  if (!p) {
    p = fetch(`${BASE}bible/${file}?v=${__BUILD__}`).then((r) => {
      if (!r.ok) throw new Error('본문을 불러오지 못했습니다')
      return r.json()
    })
    bookCache.set(file, p)
  }
  return p
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
