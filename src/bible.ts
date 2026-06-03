/** 성경 권/장 메타데이터 로더. 본문은 저작권 문제로 저장하지 않는다. */

export interface BookMeta {
  order: number
  book: string
  abbr: string
  chapters: number
}

// Vite base('/EDABible/') 기준 — GitHub Pages 서브경로 대응
const BASE = import.meta.env.BASE_URL

let indexCache: Promise<BookMeta[]> | null = null

export function loadIndex(): Promise<BookMeta[]> {
  if (!indexCache) {
    indexCache = fetch(`${BASE}bible/index.json`).then((r) => {
      if (!r.ok) throw new Error('성경 목록을 불러오지 못했습니다')
      return r.json()
    })
  }
  return indexCache
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
