import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { HighlightColor, VerseHighlight } from '../types'
import { HIGHLIGHT_COLORS } from '../highlights'

interface Props {
  text: string
  /** 하이라이트 키 계산의 시작 장 — 생략 시 1 */
  startChapter?: number
  /** 형광펜 하이라이트 목록 — 안정 참조 필수(normalizeEntry가 보장) */
  highlightRanges?: readonly VerseHighlight[]
  /** 형광펜 드래그 결과 적용 — 생략하면 형광펜 비활성 */
  onApplyRanges?: (adds: VerseHighlight[]) => void
  /** 칠해진 파트 탭 삭제 */
  onRemoveRange?: (key: string, start: number, end: number) => void
  /** 형광펜 색 — null/생략이면 형광펜 꺼짐(일반 텍스트 선택·복사 가능) */
  penColor?: HighlightColor | null
}

const VERSE_MARKER = /\((\d{1,3}(?:[-~]\d{1,3})?)\)\s*/g
const HEADING_MARKER = /^\[\[(.+)\]\]$/
const PAREN_HEADING = /^\((?!\d{1,3}(?:[-~]\d{1,3})?\))(.{2,80})\)$/

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

/* ── 파트 분할 — 하이라이트가 있는 구절만 텍스트를 range 경계로 쪼갠다.
   파트당 text-decoration이 정확히 1겹이라 밑줄 렌더가 결정적이고
   html-to-image 캡처에서도 동일하게 그려진다. ── */

interface Part {
  text: string
  /** null이면 밑줄 없는 일반 텍스트 */
  color: HighlightColor | null
  /** 하이라이트 파트만 좌표 보유 — 탭 삭제 대상 식별(data-hl) */
  range: { start: number; end: number } | null
}

function segmentParts(text: string, ranges: readonly VerseHighlight[] | undefined): Part[] | null {
  if (!ranges || ranges.length === 0) return null
  // 본문 편집으로 어긋난 range는 clamp/drop (orphan 허용 — 데이터는 보존)
  const valid = ranges
    .map((r) => ({ ...r, end: Math.min(r.end, text.length) }))
    .filter((r) => r.start < r.end && r.start < text.length)
  if (valid.length === 0) return null

  const parts: Part[] = []
  let pos = 0
  for (const r of valid) {
    if (pos < r.start) parts.push({ text: text.slice(pos, r.start), color: null, range: null })
    parts.push({ text: text.slice(r.start, r.end), color: r.color, range: { start: r.start, end: r.end } })
    pos = r.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), color: null, range: null })
  return parts
}

function markClass(color: HighlightColor): string {
  return color === 'gold' ? 'verse-mark' : `verse-mark verse-mark--${color}`
}

/** 드래그 Range를 각 구절(verse-body[data-vk]) 내부 문자 오프셋으로 변환.
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

/* ── 형광펜 드래그.
   네이티브 텍스트 선택을 쓰지 않아 iOS/Android 복사 메뉴가 아예 뜨지 않는다.
   .hl-pen(touch-action: pan-y) 덕에 세로 드래그는 스크롤, 가로 시작 드래그만
   여기로 온다. 본체와 분리된 형제 컴포넌트라 드래그 중 본문 블록은 재렌더되지
   않는다(획 입력 성능 보호). ── */

interface Caret {
  node: Node
  offset: number
}

function caretFromPoint(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    return range ? { node: range.startContainer, offset: range.startOffset } : null
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null
  }
  return null
}

/** 두 캐럿으로 방향 정규화된 Range 구성 */
function rangeBetween(a: Caret, b: Caret): Range {
  const probe = document.createRange()
  probe.setStart(a.node, a.offset)
  probe.collapse(true)
  const reversed = probe.comparePoint(b.node, b.offset) < 0
  const range = document.createRange()
  if (reversed) {
    range.setStart(b.node, b.offset)
    range.setEnd(a.node, a.offset)
  } else {
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
  }
  return range
}

const DRAG_THRESHOLD = 6

function DragHighlighter({
  rootRef,
  color,
  onApply,
  justDraggedRef,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  color: HighlightColor
  onApply: (adds: VerseHighlight[]) => void
  /** 드래그 직후 플래그 — 뒤따르는 click이 파트 삭제로 오인되지 않게 PassageText와 공유 */
  justDraggedRef: RefObject<boolean>
}) {
  const [rects, setRects] = useState<DOMRect[] | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let session: {
      pointerId: number
      startX: number
      startY: number
      anchor: Caret
      moved: boolean
      range: Range | null
    } | null = null

    // 메모리 v1.5.40 교훈: setPointerCapture 금지(iOS Safari 캡처 미해제 버그).
    // pointerdown 시 window capture 단계에 pointerId 필터로 등록하는 수동 캡처 패턴.
    const detach = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
    }

    const finish = (apply: boolean) => {
      const s = session
      session = null
      detach()
      setRects(null)
      if (!apply || !s?.moved || !s.range || s.range.collapsed) return
      const adds = collectAdds(root, s.range)
      if (adds.length === 0) return
      onApply(adds.map((a) => ({ ...a, color })))
      justDraggedRef.current = true
      setTimeout(() => {
        justDraggedRef.current = false
      }, 400)
    }

    const onMove = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      if (!session.moved) {
        const dx = Math.abs(e.clientX - session.startX)
        const dy = Math.abs(e.clientY - session.startY)
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
        session.moved = true
      }
      const focus = caretFromPoint(e.clientX, e.clientY)
      if (!focus || !root.contains(focus.node)) return
      const range = rangeBetween(session.anchor, focus)
      session.range = range
      setRects([...range.getClientRects()])
    }

    const onUp = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      finish(true)
    }

    // 세로 팬(스크롤)으로 넘어가면 브라우저가 cancel을 보낸다 — 프리뷰만 정리
    const onCancel = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      finish(false)
    }

    const onDown = (e: PointerEvent) => {
      if (session) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target as HTMLElement
      if (!target.closest?.('[data-vk]')) return
      const anchor = caretFromPoint(e.clientX, e.clientY)
      if (!anchor || !root.contains(anchor.node)) return
      session = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        anchor,
        moved: false,
        range: null,
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
    }

    root.addEventListener('pointerdown', onDown)
    return () => {
      root.removeEventListener('pointerdown', onDown)
      detach()
    }
  }, [rootRef, color, onApply, justDraggedRef])

  if (!rects || rects.length === 0) return null

  const hex = HIGHLIGHT_COLORS.find((c) => c.color === color)!.hex
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
      {rects.map((r, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            background: hex,
            opacity: 0.35,
            borderRadius: 2,
          }}
        />
      ))}
    </div>,
    document.body,
  )
}

// memo: 손글씨 획이 커밋될 때마다 EntryPage 전체가 재렌더되는데, 그때마다
// 장 전체를 재파싱·재렌더하면 다음 획 입력 처리가 밀린다. props가 같으면 건너뛴다.
// (highlightRanges·콜백 모두 안정 참조여야 효과가 유지된다)
function PassageText({
  text,
  startChapter = 1,
  highlightRanges,
  onApplyRanges,
  onRemoveRange,
  penColor,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const justDraggedRef = useRef(false)
  const blocks = useMemo(() => splitBlocks(text, startChapter), [text, startChapter])
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

  const handleRemove = (verseKey: string, range: { start: number; end: number }) => {
    if (!onRemoveRange) return
    // 펜 필기 중(ink-active) 오탭 방지
    if (document.body.classList.contains('ink-active')) return
    // 형광펜 드래그 직후 따라오는 click은 삭제로 치지 않는다
    if (justDraggedRef.current) return
    // 텍스트 드래그 선택(복사) 직후의 click도 무시
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    onRemoveRange(verseKey, range.start, range.end)
  }

  return (
    <>
      <div
        ref={rootRef}
        className={`selectable-text passage-text font-serif text-[15px] leading-[1.75] text-rose-ink${
          penColor ? ' hl-pen' : ''
        }`}
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

          const parts = block.verseKey
            ? segmentParts(block.text, rangesByKey.get(block.verseKey))
            : null

          return (
            <p key={`${block.label ?? 'intro'}-${index}`} className="passage-segment">
              {block.label && <span className="passage-verse">{block.label}</span>}
              <span className="verse-body" data-vk={block.verseKey ?? undefined}>
                {parts
                  ? parts.map((part, i) =>
                      part.color && part.range ? (
                        <span
                          key={i}
                          className={markClass(part.color)}
                          data-hl={`${part.range.start}-${part.range.end}`}
                          onClick={() => handleRemove(block.verseKey!, part.range!)}
                        >
                          {part.text}
                        </span>
                      ) : (
                        part.text
                      ),
                    )
                  : block.text}
              </span>
            </p>
          )
        })}
      </div>
      {penColor && onApplyRanges && (
        <DragHighlighter
          rootRef={rootRef}
          color={penColor}
          onApply={onApplyRanges}
          justDraggedRef={justDraggedRef}
        />
      )}
    </>
  )
}

export default memo(PassageText)
