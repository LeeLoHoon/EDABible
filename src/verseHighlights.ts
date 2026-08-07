import { getBibleVersion } from './bibleVersion'
import { getLang } from './i18n/lang'
import type { Block } from './passageBlocks'
import type { VerseHighlight } from './types'

/**
 * 형광펜을 묵상이 아니라 성경 본문에 귀속시키기 위한 좌표 변환.
 *
 * PassageText는 화면에 그려진 본문 기준의 상대 키(`verseKey`)로 구절을 식별한다. 그 키는
 * 본문 시작 장에 따라 값이 달라져 다른 묵상과 공유할 수 없으므로, 저장할 때는 장 단위
 * 절대 좌표(bookOrder + chapter + 장 내 키)로 바꿔 둔다. 이 파일은 그 양방향 변환만 한다.
 */

/** 저장 단위 — 한 역본의 한 장 */
export interface ChapterRef {
  bookOrder: number
  chapter: number
}

/** 화면의 구절 하나와 그 절대 좌표를 잇는 고리 */
export interface HighlightAnchor extends ChapterRef {
  /** PassageText가 쓰는 상대 키 */
  verseKey: string
  /** 장 안에서의 키 — 절 마커가 있으면 라벨('12', '2-3'), 없으면 문단 순번('p0') */
  chapterVerseKey: string
}

/**
 * 지금 화면이 보고 있는 본문의 저장 축. 역본마다 본문이 다르면 문자 오프셋도 달라져
 * 밑줄을 공유할 수 없으므로, 영어 본문은 한국어 역본과 따로 둔다.
 */
export function highlightVersionKey(): string {
  return getLang() === 'en' ? 'en' : getBibleVersion()
}

/** 장 단위 저장소의 키 */
export function chapterKey(ref: ChapterRef): string {
  return `${ref.bookOrder}:${ref.chapter}`
}

export function parseChapterKey(key: string): ChapterRef | null {
  const [bookOrder, chapter] = key.split(':').map(Number)
  if (!Number.isInteger(bookOrder) || !Number.isInteger(chapter)) return null
  return { bookOrder, chapter }
}

/**
 * 렌더된 블록에서 상대 키 ↔ 절대 좌표 고리를 뽑는다. 장 좌표를 모르는 조각(본문 여러 개일 때
 * 끼우는 참조 줄 등)은 공유 대상이 아니므로 건너뛴다.
 */
export function buildHighlightAnchors(blocks: readonly Block[]): HighlightAnchor[] {
  const anchors: HighlightAnchor[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.type !== 'segment') continue
    if (typeof block.bookOrder !== 'number' || typeof block.chapter !== 'number') continue
    // 같은 상대 키가 두 번 나오면 첫 구절만 고리로 삼는다 — 렌더도 첫 구절을 기준으로 한다
    if (seen.has(block.verseKey)) continue
    seen.add(block.verseKey)

    anchors.push({
      verseKey: block.verseKey,
      bookOrder: block.bookOrder,
      chapter: block.chapter,
      chapterVerseKey: block.verseLabel ?? `p${block.paragraphIndex}`,
    })
  }

  return anchors
}

/** 이 본문이 걸쳐 있는 장 목록 (중복 제거) */
export function chapterRefsOf(anchors: readonly HighlightAnchor[]): ChapterRef[] {
  const refs = new Map<string, ChapterRef>()
  for (const anchor of anchors) {
    const key = chapterKey(anchor)
    if (!refs.has(key)) refs.set(key, { bookOrder: anchor.bookOrder, chapter: anchor.chapter })
  }
  return [...refs.values()]
}

/**
 * 저장된 장별 밑줄을 화면 좌표로 되돌린다. 지금 본문에 없는 구절의 밑줄은 그냥 빠진다
 * (다른 장에 그은 밑줄이 엉뚱한 구절에 나타나지 않게 하는 것이 이 함수의 핵심이다).
 */
export function toRenderRanges(
  anchors: readonly HighlightAnchor[],
  stored: ReadonlyMap<string, readonly VerseHighlight[]>,
): VerseHighlight[] {
  const ranges: VerseHighlight[] = []
  for (const anchor of anchors) {
    const chapterRanges = stored.get(chapterKey(anchor))
    if (!chapterRanges) continue
    for (const range of chapterRanges) {
      if (range.key !== anchor.chapterVerseKey) continue
      ranges.push({ ...range, key: anchor.verseKey })
    }
  }
  return ranges
}

/** 화면 좌표의 밑줄을 장별로 나눠 저장 좌표로 바꾼다 */
export function groupRangesByChapter(
  anchors: readonly HighlightAnchor[],
  ranges: readonly VerseHighlight[],
): Map<string, VerseHighlight[]> {
  const byVerseKey = new Map(anchors.map((anchor) => [anchor.verseKey, anchor]))
  const grouped = new Map<string, VerseHighlight[]>()

  for (const range of ranges) {
    const anchor = byVerseKey.get(range.key)
    if (!anchor) continue
    const key = chapterKey(anchor)
    const list = grouped.get(key) ?? []
    list.push({ ...range, key: anchor.chapterVerseKey })
    grouped.set(key, list)
  }

  return grouped
}

/** 로컬(IndexedDB)에 저장되는 한 장의 밑줄 */
export interface VerseHighlightRecord extends ChapterRef {
  /** 계정 uuid 또는 로컬 소유자 */
  ownerId: string
  /** 역본 — msg/gae/sae는 본문이 달라 문자 오프셋이 호환되지 않는다 */
  version: string
  ranges: VerseHighlight[]
  /** 서버가 확정한 revision. 아직 올라간 적 없으면 0 */
  revision: number
  dirty?: boolean
  conflict?: boolean
  updatedAt: number
}

/** list_my_verse_highlights()가 돌려주는 메타 한 줄 */
export interface RemoteHighlightMeta extends ChapterRef {
  version: string
  revision: number
}

/** 대조에 쓰는 로컬 메타 */
export interface LocalHighlightMeta {
  revision: number
  dirty?: boolean
}

/** 로컬 저장소의 행 키 — 소유자·역본·장까지 나눠야 계정이나 역본이 섞이지 않는다 */
export function highlightRowKey(ownerId: string, version: string, ref: ChapterRef): string {
  return `${ownerId}|${version}|${ref.bookOrder}:${ref.chapter}`
}

/** 원격에서 받아와야 할 장을 고른다 — 못 올린 편집이 있으면 원격으로 덮지 않는다 */
export function selectHighlightPulls(
  remote: readonly RemoteHighlightMeta[],
  local: ReadonlyMap<string, LocalHighlightMeta>,
  ownerId: string,
): RemoteHighlightMeta[] {
  return remote.filter((meta) => {
    const cached = local.get(highlightRowKey(ownerId, meta.version, meta))
    if (cached?.dirty) return false
    return !cached || cached.revision < meta.revision
  })
}

/** 재전송 대상인지 — 충돌은 사용자가 정리할 때까지 자동 재시도하지 않는다 */
export function isHighlightPushable(record: VerseHighlightRecord, ownerId: string): boolean {
  return record.ownerId === ownerId && record.dirty === true && record.conflict !== true
}

function messageIncludes(error: unknown, token: string): boolean {
  if (error instanceof Error) return error.message.includes(token)
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes(token)
  )
}

export function isStaleHighlightError(error: unknown): boolean {
  return messageIncludes(error, 'VERSE_HIGHLIGHT_STALE_REVISION')
}

export function highlightRevisionFromResponse(data: unknown): number {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('revision' in data) ||
    typeof data.revision !== 'number' ||
    !Number.isInteger(data.revision) ||
    data.revision < 1
  ) {
    throw new Error('VERSE_HIGHLIGHT_INVALID_RESPONSE')
  }
  return data.revision
}

/** 원격 jsonb를 밑줄 배열로 되돌린다 — 손상된 항목은 버린다 */
export function normalizeRemoteRanges(raw: unknown): VerseHighlight[] {
  if (!Array.isArray(raw)) return []
  const ranges: VerseHighlight[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const source = item as Partial<VerseHighlight>
    if (typeof source.key !== 'string') continue
    if (typeof source.start !== 'number' || typeof source.end !== 'number') continue
    if (!(source.start < source.end)) continue
    const color = source.color
    if (color !== 'gold' && color !== 'green' && color !== 'pink') continue
    ranges.push({ key: source.key, start: source.start, end: source.end, color })
  }
  return ranges
}
