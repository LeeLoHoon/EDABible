import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { HighlightColor, VerseHighlight } from '../types'

interface Props {
  text: string
  /** 하이라이트 키 계산의 시작 장 — 생략 시 1 */
  startChapter?: number
  /** 구절 전체 하이라이트 키 목록 — 안정 참조 필수(normalizeEntry가 보장) */
  highlights?: readonly string[]
  /** 구절 탭 토글 콜백 — 생략하면 비인터랙티브 렌더 */
  onToggleVerse?: (verseKey: string) => void
  /** 부분(드래그 선택) 하이라이트 목록 — 안정 참조 필수 */
  highlightRanges?: readonly VerseHighlight[]
  /** 드래그 선택 범위에 색 적용 — 생략하면 팔레트 비활성 */
  onApplyRanges?: (adds: VerseHighlight[]) => void
  /** 부분 하이라이트 파트 탭 삭제 */
  onRemoveRange?: (key: string, start: number, end: number) => void
}

const VERSE_MARKER = /\((\d{1,3}(?:[-~]\d{1,3})?)\)\s*/g
const HEADING_MARKER = /^\[\[(.+)\]\]$/
const PAREN_HEADING = /^\((?!\d{1,3}(?:[-~]\d{1,3})?\))(.{2,80})\)$/

/** 팔레트 점 버튼 색 — index.css의 .verse-mark(--green/--pink)와 동기 유지할 것 */
const HIGHLIGHT_COLORS: { color: HighlightColor; hex: string; label: string }[] = [
  { color: 'gold', hex: '#d9cb6a', label: '골드' },
  { color: 'green', hex: '#92bfa0', label: '그린' },
  { color: 'pink', hex: '#e8a7b7', label: '핑크' },
]

interface Segment {
  label: string | null
  text: string
}

type Block =
  | {
      type: 'heading'
      text: string
    }
  | {
      type: 'segment'
      label: string | null
      text: string
      /** '<장 카운터>:<절 라벨>' — 라벨 없는 세그먼트(도입부·다권 ref 라인)는 null */
      verseKey: string | null
    }

function splitPassage(text: string): Segment[] {
  const segments: Segment[] = []
  let currentLabel: string | null = null
  let last = 0

  for (const match of text.matchAll(VERSE_MARKER)) {
    const before = text.slice(last, match.index).trim()
    if (before) segments.push({ label: currentLabel, text: before })
    currentLabel = match[1].replace('~', '-')
    last = match.index + match[0].length
  }

  const tail = text.slice(last).trim()
  if (tail) segments.push({ label: currentLabel, text: tail })

  return segments.length > 0 ? segments : [{ label: null, text }]
}

/* 다장 본문은 장 텍스트가 경계 표시 없이 이어 붙으므로, 절 번호가 리셋되면
   (선두 숫자 < 직전 라벨의 말미 숫자) 다음 장으로 간주해 카운터를 올린다.
   같은 본문에서 항상 동일하게 재계산되므로 키가 결정적이다.
   ※ 실제 book:chapter 기반 키가 필요해지면 BiblePicker가 장별 텍스트를
   내려주도록 확장하는 것이 정도(正道) — 후속 업그레이드 경로. */
function splitBlocks(text: string, startChapter: number): Block[] {
  const blocks: Block[] = []
  let chapter = startChapter
  let prevVerseEnd = 0

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const heading = line.match(HEADING_MARKER)
    if (heading) {
      blocks.push({ type: 'heading', text: heading[1].trim() })
      continue
    }

    const parentheticalHeading = line.match(PAREN_HEADING)
    if (parentheticalHeading) {
      blocks.push({ type: 'heading', text: parentheticalHeading[1].trim() })
      continue
    }

    for (const segment of splitPassage(line)) {
      let verseKey: string | null = null
      if (segment.label) {
        const nums = segment.label.split('-').map(Number)
        const first = nums[0]
        const last = nums[nums.length - 1]
        if (prevVerseEnd > 0 && first < prevVerseEnd) chapter += 1
        prevVerseEnd = last
        verseKey = `${chapter}:${segment.label}`
      }
      blocks.push({ type: 'segment', ...segment, verseKey })
    }
  }

  return blocks
}

/* ── 파트 분할 — 부분 range가 있는 구절만 텍스트를 경계로 쪼갠다.
   whole(구절 전체 gold)과 공존 시 gold를 filler 파트로 평탄화한다:
   파트당 text-decoration이 정확히 1겹이라 부모-자식 밑줄 페인트 순서에
   의존하지 않고, html-to-image 캡처에서도 결정적으로 그려진다. ── */

interface Part {
  text: string
  /** null이면 밑줄 없는 일반 텍스트 */
  color: HighlightColor | null
  /** 부분 range에서 온 파트만 좌표 보유 — 탭 삭제 대상 식별(data-hl) */
  range: { start: number; end: number } | null
}

function segmentParts(
  text: string,
  ranges: readonly VerseHighlight[] | undefined,
  whole: boolean,
): Part[] | null {
  if (!ranges || ranges.length === 0) return null
  // 본문 편집으로 어긋난 range는 clamp/drop (orphan 허용 — 데이터는 보존)
  const valid = ranges
    .map((r) => ({ ...r, end: Math.min(r.end, text.length) }))
    .filter((r) => r.start < r.end && r.start < text.length)
  if (valid.length === 0) return null

  const fillerColor: HighlightColor | null = whole ? 'gold' : null
  const parts: Part[] = []
  let pos = 0
  for (const r of valid) {
    if (pos < r.start) parts.push({ text: text.slice(pos, r.start), color: fillerColor, range: null })
    parts.push({ text: text.slice(r.start, r.end), color: r.color, range: { start: r.start, end: r.end } })
    pos = r.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), color: fillerColor, range: null })
  return parts
}

function markClass(color: HighlightColor): string {
  return color === 'gold' ? 'verse-mark' : `verse-mark verse-mark--${color}`
}

/* ── 드래그 선택 → 플로팅 색 팔레트.
   PassageText 본체와 분리된 형제 컴포넌트가 selection 상태를 소유해서,
   선택 핸들을 드래그하는 동안 본문 블록이 재렌더되지 않는다(획 입력 성능 보호). ── */

interface PaletteState {
  left: number
  top: number
  adds: Omit<VerseHighlight, 'color'>[]
}

const PALETTE_WIDTH = 132
const PALETTE_HEIGHT = 44

/** selection 범위를 각 구절(verse-body[data-vk]) 내부 문자 오프셋으로 변환.
    verse-body 서브트리는 텍스트 노드(+파트 span)뿐이라 toString().length가
    곧 문자 오프셋이다(세그먼트 텍스트에 개행 없음 — splitBlocks가 보장). */
function collectAdds(root: HTMLElement, selRange: Range): Omit<VerseHighlight, 'color'>[] {
  const adds: Omit<VerseHighlight, 'color'>[] = []
  for (const span of root.querySelectorAll<HTMLElement>('[data-vk]')) {
    if (!selRange.intersectsNode(span)) continue
    const content = document.createRange()
    content.selectNodeContents(span)
    const clipped = selRange.cloneRange()
    if (content.comparePoint(clipped.startContainer, clipped.startOffset) < 0) {
      clipped.setStart(content.startContainer, content.startOffset)
    }
    if (content.comparePoint(clipped.endContainer, clipped.endOffset) > 0) {
      clipped.setEnd(content.endContainer, content.endOffset)
    }
    const length = clipped.toString().length
    if (length === 0) continue
    const pre = content.cloneRange()
    pre.setEnd(clipped.startContainer, clipped.startOffset)
    const start = pre.toString().length
    adds.push({ key: span.dataset.vk!, start, end: start + length })
  }
  return adds
}

function SelectionPalette({
  rootRef,
  onApply,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  onApply: (adds: VerseHighlight[]) => void
}) {
  const [state, setState] = useState<PaletteState | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const compute = () => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setState(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        setState(null)
        return
      }
      // iOS는 팔레트 버튼을 누르는 순간 selection을 먼저 해제하므로
      // 오프셋은 지금(표시 시점) 계산해 저장해 둔다
      const adds = collectAdds(root, range)
      if (adds.length === 0) {
        setState(null)
        return
      }
      const rect = range.getBoundingClientRect()
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - PALETTE_WIDTH / 2, 8),
        window.innerWidth - PALETTE_WIDTH - 8,
      )
      // 기본은 선택 아래(iOS 네이티브 콜아웃이 위쪽에 뜨므로 회피), 하단 부족 시 위
      const below = rect.bottom + 8
      const top =
        below + PALETTE_HEIGHT > window.innerHeight - 8 ? rect.top - PALETTE_HEIGHT - 8 : below
      setState({ left, top, adds })
    }

    const onSelectionChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(compute, 250)
    }
    const hide = () => {
      if (timer) clearTimeout(timer)
      setState(null)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    // capture: 본문 카드의 내부 스크롤 컨테이너는 window로 버블되지 않는다
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [rootRef])

  if (!state) return null

  return createPortal(
    <div
      role="toolbar"
      aria-label="하이라이트 색 선택"
      className="fixed z-50 flex items-center gap-2 rounded-full border border-rose-line bg-rose-card px-2.5 py-2 shadow-lift"
      style={{ left: state.left, top: state.top }}
      onPointerDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.color}
          type="button"
          aria-label={`${c.label} 하이라이트`}
          className="h-7 w-7 rounded-full border border-black/10 transition active:scale-90"
          style={{ background: c.hex }}
          onClick={() => {
            onApply(state.adds.map((a) => ({ ...a, color: c.color })))
            window.getSelection()?.removeAllRanges()
            setState(null)
          }}
        />
      ))}
    </div>,
    document.body,
  )
}

// memo: 손글씨 획이 커밋될 때마다 EntryPage 전체가 재렌더되는데, 그때마다
// 장 전체를 재파싱·재렌더하면 다음 획 입력 처리가 밀린다. props가 같으면 건너뛴다.
// (highlights·highlightRanges·콜백 모두 안정 참조여야 효과가 유지된다)
function PassageText({
  text,
  startChapter = 1,
  highlights,
  onToggleVerse,
  highlightRanges,
  onApplyRanges,
  onRemoveRange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => splitBlocks(text, startChapter), [text, startChapter])
  const highlightSet = useMemo(() => new Set(highlights ?? []), [highlights])
  const rangesByKey = useMemo(() => {
    const map = new Map<string, VerseHighlight[]>()
    for (const r of highlightRanges ?? []) {
      const list = map.get(r.key)
      if (list) list.push(r)
      else map.set(r.key, [r])
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start)
    return map
  }, [highlightRanges])

  const interactive = !!(onToggleVerse || onRemoveRange)

  const handleTap = (verseKey: string, e: React.MouseEvent) => {
    // 펜 필기 중(ink-active) 손바닥·펜 오탭으로 토글되는 것을 방지
    if (document.body.classList.contains('ink-active')) return
    // 본문 드래그 선택(복사·팔레트) 직후의 click은 토글로 치지 않는다
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    // 부분 하이라이트 파트를 탭하면 그 range만 지운다 (구절 전체 토글로 흐르지 않음)
    const hl = (e.target as HTMLElement).closest?.('[data-hl]')
    if (hl && onRemoveRange) {
      const [start, end] = (hl.getAttribute('data-hl') ?? '').split('-').map(Number)
      if (Number.isFinite(start) && Number.isFinite(end)) onRemoveRange(verseKey, start, end)
      return
    }
    onToggleVerse?.(verseKey)
  }

  return (
    <>
      <div
        ref={rootRef}
        className="selectable-text passage-text font-serif text-[15px] leading-[1.75] text-rose-ink"
      >
        {blocks.map((block, index) => {
          if (block.type === 'heading') {
            return (
              <h4
                key={`heading-${block.text}-${index}`}
                className="mb-1.5 mt-4 font-sans text-[0.82rem] font-black text-rose-ink first:mt-0"
              >
                {block.text}
              </h4>
            )
          }

          const whole = !!block.verseKey && highlightSet.has(block.verseKey)
          const parts = block.verseKey
            ? segmentParts(block.text, rangesByKey.get(block.verseKey), whole)
            : null

          return (
            <p
              key={`${block.label ?? 'intro'}-${index}`}
              className={`passage-segment${interactive && block.verseKey ? ' verse-tap' : ''}`}
              onClick={
                interactive && block.verseKey
                  ? (e) => handleTap(block.verseKey!, e)
                  : undefined
              }
            >
              {block.label && <span className="passage-verse">{block.label}</span>}
              {parts ? (
                // 파트 평탄화: verse-body 자체엔 밑줄을 긋지 않는다(중첩 decoration 방지)
                <span className="verse-body" data-vk={block.verseKey!}>
                  {parts.map((part, i) =>
                    part.color ? (
                      <span
                        key={i}
                        className={markClass(part.color)}
                        data-hl={part.range ? `${part.range.start}-${part.range.end}` : undefined}
                      >
                        {part.text}
                      </span>
                    ) : (
                      part.text
                    ),
                  )}
                </span>
              ) : (
                <span
                  className={`verse-body${whole ? ' verse-mark' : ''}`}
                  data-vk={block.verseKey ?? undefined}
                >
                  {block.text}
                </span>
              )}
            </p>
          )
        })}
      </div>
      {onApplyRanges && <SelectionPalette rootRef={rootRef} onApply={onApplyRanges} />}
    </>
  )
}

export default memo(PassageText)
