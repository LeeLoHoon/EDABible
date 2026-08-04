/* 설교 참조의 절 범위 표기(SermonPassage.verseLabel) → 실제 본문 자르기.

   관리자가 "로마서 13:8-10"이라고 적으면 묵상 화면도 그 절만 보여줘야 한다.
   자른 결과는 다시 splitBlocks(passageBlocks.ts)를 통과하므로 절 마커는 원문 그대로 남긴다.

   역본마다 마커 정밀도가 다르다는 점이 이 모듈의 전제다.
   - 개역/새번역/영문: (1) (2) (3) — 절 단위라 요청대로 정확히 잘린다
   - 메시지(기본 역본): (1-3) (3-5) 처럼 범위형이고 서로 겹친다
   그래서 '요청 범위와 겹치는 문단은 통째로 남긴다'가 유일하게 성립하는 규칙이다.
   요청보다 조금 넓게 보일 수는 있어도, 묵상해야 할 절이 사라지지는 않는다. */

import { HEADING_MARKER, PAREN_HEADING, VERSE_MARKER } from './passageBlocks'

export interface VerseRange {
  from: number
  to: number
}

/** '13:8-10' / '2:17' / '8-10' / '17' — 장이 없으면 fallbackChapter 소속으로 본다 */
const LABEL_ITEM = /^(?:(\d{1,3})\s*:\s*)?(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?$/

function toRange(first: number, second: number | undefined): VerseRange {
  const last = second ?? first
  // '10-8'처럼 뒤집어 적어도 의도대로 읽는다
  return first <= last ? { from: first, to: last } : { from: last, to: first }
}

/**
 * 절 범위 표기를 장별 범위 목록으로 파싱한다.
 * 쉼표로 여러 개를 적을 수 있고('8:28-30, 9:1'), 해석 못 하는 항목은 조용히 버린다 —
 * 표기가 엉망이라고 본문을 감추는 것보다 장 전체를 보여주는 편이 낫기 때문이다.
 */
export function parseVerseLabel(
  label: string | undefined,
  fallbackChapter: number,
): Map<number, VerseRange[]> {
  const byChapter = new Map<number, VerseRange[]>()
  if (!label?.trim()) return byChapter

  for (const rawItem of label.split(',')) {
    const item = rawItem.trim()
    if (!item) continue
    const match = LABEL_ITEM.exec(item)
    if (!match) continue

    const chapter = match[1] ? Number(match[1]) : fallbackChapter
    const range = toRange(Number(match[2]), match[3] ? Number(match[3]) : undefined)
    const list = byChapter.get(chapter)
    if (list) list.push(range)
    else byChapter.set(chapter, [range])
  }

  return byChapter
}

interface Piece {
  /** 마커까지 포함한 원문 조각 — 그대로 다시 이어 붙인다 */
  raw: string
  /** 마커가 알려주는 절 범위. 줄 선두의 마커 없는 조각은 null */
  range: VerseRange | null
}

function labelToRange(label: string): VerseRange {
  const nums = label.split(/[-~]/).map(Number)
  return toRange(nums[0], nums[nums.length - 1])
}

/** 한 줄을 절 마커 경계로 조각낸다 — splitPassage와 같은 경계, 다만 마커 문자열을 살려 둔다 */
function splitLine(line: string): Piece[] {
  const marks = [...line.matchAll(VERSE_MARKER)]
  if (marks.length === 0) return [{ raw: line, range: null }]

  const pieces: Piece[] = []
  const head = line.slice(0, marks[0].index).trim()
  if (head) pieces.push({ raw: head, range: null })

  for (const [index, mark] of marks.entries()) {
    const end = index + 1 < marks.length ? marks[index + 1].index : line.length
    const raw = line.slice(mark.index, end).trim()
    if (raw) pieces.push({ raw, range: labelToRange(mark[1]) })
  }

  return pieces
}

function firstMarkerFrom(text: string): number | null {
  for (const match of text.matchAll(VERSE_MARKER)) return labelToRange(match[1]).from
  return null
}

function overlaps(range: VerseRange, wanted: readonly VerseRange[]): boolean {
  return wanted.some((item) => range.from <= item.to && range.to >= item.from)
}

function isHeading(line: string): boolean {
  return HEADING_MARKER.test(line) || PAREN_HEADING.test(line)
}

/**
 * 요청한 절 범위와 겹치는 부분만 남긴 본문을 돌려준다.
 * 남길 게 없거나 절 마커가 아예 없으면 원본을 그대로 돌려준다 — 본문 실종이 최악이라서다.
 */
export function sliceVerses(text: string, wanted: readonly VerseRange[]): string {
  if (wanted.length === 0 || !text.trim()) return text

  // 마커 없는 선두 문단이 몇 절인지는 '첫 마커 직전까지'로 추정한다.
  // 메시지 성경 시편 1편처럼 (2-3)부터 시작하는 장에서 1절 문단을 지키기 위한 규칙이다.
  const firstMarker = firstMarkerFrom(text)
  if (firstMarker === null) return text
  const leadRange: VerseRange = { from: 1, to: Math.max(1, firstMarker - 1) }

  const outLines: string[] = []
  let pendingHeading: string | null = null
  let previousRange: VerseRange | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    if (isHeading(line)) {
      // 소제목은 뒤따르는 본문이 살아남을 때만 따라간다
      pendingHeading = line
      continue
    }

    const kept: string[] = []
    for (const piece of splitLine(line)) {
      // 줄 선두의 마커 없는 조각은 직전 마커 문단의 연속으로 본다(첫 마커 전이면 선두 범위)
      const range = piece.range ?? previousRange ?? leadRange
      if (piece.range) previousRange = piece.range
      if (overlaps(range, wanted)) kept.push(piece.raw)
    }
    if (kept.length === 0) continue

    if (pendingHeading) {
      outLines.push(pendingHeading)
      pendingHeading = null
    }
    outLines.push(kept.join(' '))
  }

  return outLines.length > 0 ? outLines.join('\n') : text
}
