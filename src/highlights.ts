import type { HighlightColor, VerseHighlight } from './types'

/** 형광펜 색 정의 — index.css의 .verse-mark(--green/--pink)와 동기 유지할 것 */
export const HIGHLIGHT_COLORS: { color: HighlightColor; hex: string }[] = [
  { color: 'gold', hex: '#d9cb6a' },
  { color: 'green', hex: '#92bfa0' },
  { color: 'pink', hex: '#e8a7b7' },
]

/* 부분 하이라이트 range 산술 — PassageText가 렌더하고 TranscribeSection이
   functional update에 사용하는 순수 함수. (컴포넌트 파일에서 분리 — Fast Refresh 규칙) */

/** 새 range들을 적용한다. 같은 key에서 겹치는 구간은 색 무관하게 절단(덮어쓰기)한 뒤,
    같은 색으로 정확히 인접한 range와 병합한다. 불변식: 같은 key 안에서 서로 겹치지 않음.
    같은 색 재적용은 멱등, 다른 색은 겹친 구간만 새 색으로 바뀐다. */
export function applyRanges(
  existing: readonly VerseHighlight[],
  adds: readonly VerseHighlight[],
): VerseHighlight[] {
  let out = [...existing]

  for (const add of adds) {
    if (add.end <= add.start) continue

    // 1) subtract — 겹치는 구간을 add 경계에서 자르고 좌우 잔여만 남긴다
    const next: VerseHighlight[] = []
    for (const r of out) {
      if (r.key !== add.key || r.end <= add.start || r.start >= add.end) {
        next.push(r)
        continue
      }
      if (r.start < add.start) next.push({ ...r, end: add.start })
      if (r.end > add.end) next.push({ ...r, start: add.end })
    }

    // 2) merge — 같은 key·같은 색·정확히 인접한 range만 흡수 (subtract 후라 좌우 최대 1개씩)
    let merged = { ...add }
    const rest: VerseHighlight[] = []
    for (const r of next) {
      if (
        r.key === merged.key &&
        r.color === merged.color &&
        (r.end === merged.start || r.start === merged.end)
      ) {
        merged = {
          ...merged,
          start: Math.min(merged.start, r.start),
          end: Math.max(merged.end, r.end),
        }
      } else {
        rest.push(r)
      }
    }
    out = [...rest, merged]
  }

  return out.sort((a, b) => (a.key === b.key ? a.start - b.start : a.key < b.key ? -1 : 1))
}

/** 정확히 일치하는 range 하나를 제거한다 (파트 탭 삭제용) */
export function removeRange(
  existing: readonly VerseHighlight[],
  key: string,
  start: number,
  end: number,
): VerseHighlight[] {
  return existing.filter((r) => !(r.key === key && r.start === start && r.end === end))
}
