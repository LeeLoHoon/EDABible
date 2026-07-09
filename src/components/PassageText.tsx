import { Fragment, memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { HighlightColor, VerseHighlight } from '../types'
import type { PassageChunk } from './BiblePicker'
import { HIGHLIGHT_COLORS } from '../highlights'

interface Props {
  /** 장 단위로 쪼갠 본문. 이어 붙이면 원래 본문 문자열이 된다 */
  chunks: readonly PassageChunk[]
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

/** 장이 바뀌는 첫 블록에만 붙는다 — 이 값이 있으면 블록 앞에 구분선을 그린다 */
interface ChapterMark {
  chapterLabel?: string
}

type Block = ChapterMark &
  (
    | {
        type: 'heading'
        text: string
      }
    | {
        type: 'segment'
        label: string | null
        text: string
        /** 절 마커 있으면 '<장 카운터>:<절 라벨>', 없으면 위치 기반 'p<블록 인덱스>' —
            스캔 전사본은 절 마커 없는 문단이 많아(365개 장) 모든 문단이 칠해질 수 있어야 한다 */
        verseKey: string
      }
  )

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

/* 장 경계는 chunk가 알려주지만, 하이라이트 키의 '장 카운터'는 예전 그대로
   절 번호 리셋(선두 숫자 < 직전 라벨의 말미 숫자)으로 추론한다. 이미 칠해둔
   하이라이트를 하나도 잃지 않기 위해서다 — 이 카운터는 화면에 나오지 않는
   고유 ID일 뿐이라(types.ts) 실제 장 번호와 달라도 무방하다.
   chunk를 가로질러 blocks·chapter·prevVerseEnd가 이어지므로, 이어 붙인 문자열
   하나를 파싱하던 예전과 블록 시퀀스도 verseKey도 완전히 동일하다. */
function splitBlocks(chunks: readonly PassageChunk[], startChapter: number): Block[] {
  const blocks: Block[] = []
  let chapter = startChapter
  let prevVerseEnd = 0
  let labeledChunks = 0

  for (const chunk of chunks) {
    const chunkStart = blocks.length

    for (const rawLine of chunk.text.split('\n')) {
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
        let verseKey: string
        if (segment.label) {
          const nums = segment.label.split('-').map(Number)
          const first = nums[0]
          const last = nums[nums.length - 1]
          if (prevVerseEnd > 0 && first < prevVerseEnd) chapter += 1
          prevVerseEnd = last
          verseKey = `${chapter}:${segment.label}`
        } else {
          // 마커 없는 문단(도입부·스캔 전사 누락 등)도 위치 키로 칠할 수 있게 —
          // 본문 편집으로 인덱스가 밀리면 orphan(렌더에서 무시)으로 수용
          verseKey = `p${blocks.length}`
        }
        blocks.push({ type: 'segment', ...segment, verseKey })
      }
    }

    if (!chunk.label || blocks.length === chunkStart) continue
    labeledChunks += 1
    // 첫 장 앞에는 구분선을 두지 않는다 — 헤더가 이미 '시편 13~18편'을 보여준다
    if (labeledChunks > 1) blocks[chunkStart].chapterLabel = chunk.label
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
      /** 첫 유의미한 이동 방향으로 결정 — 가로 우세=칠하기, 세로 우세=스크롤 양보 */
      intent: 'paint' | 'scroll' | null
      range: Range | null
      raf: number
      pendingPoint: { x: number; y: number } | null
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
      if (s?.raf) cancelAnimationFrame(s.raf)
      setRects(null)
      if (!apply || !s || s.intent !== 'paint' || !s.range || s.range.collapsed) return
      const adds = collectAdds(root, s.range)
      if (adds.length === 0) return
      onApply(adds.map((a) => ({ ...a, color })))
      justDraggedRef.current = true
      setTimeout(() => {
        justDraggedRef.current = false
      }, 400)
    }

    // 캐럿 히트테스트(레이아웃 비용)는 프레임당 1회로 스로틀 — 저사양 폰에서
    // 고주파 pointermove가 메인스레드를 포화시키는 것을 방지
    const processPoint = () => {
      if (!session) return
      session.raf = 0
      const point = session.pendingPoint
      if (!point) return
      session.pendingPoint = null
      // 앵커 노드가 리렌더로 교체됐으면(직전 apply 직후 등) 세션을 조용히 버린다
      if (!root.contains(session.anchor.node)) {
        finish(false)
        return
      }
      try {
        const focus = caretFromPoint(point.x, point.y)
        if (!focus || !root.contains(focus.node)) return
        const range = rangeBetween(session.anchor, focus)
        session.range = range
        setRects([...range.getClientRects()])
      } catch {
        // Range 경계 예외(노드 교체 경합 등) — 이번 프레임만 건너뛴다
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      if (!session.intent) {
        const dx = Math.abs(e.clientX - session.startX)
        const dy = Math.abs(e.clientY - session.startY)
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
        session.intent = dx >= dy ? 'paint' : 'scroll'
        if (session.intent === 'scroll') {
          // 세로 우세 — 스크롤에 양보하고 세션 종료(브라우저 pan과 무관하게 확정)
          finish(false)
          return
        }
      }
      session.pendingPoint = { x: e.clientX, y: e.clientY }
      if (!session.raf) session.raf = requestAnimationFrame(processPoint)
    }

    const onUp = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      // 마지막 지점까지 반영하고 종료
      processPoint()
      finish(true)
    }

    // 브라우저가 제스처를 가져가면(핀치줌·시스템 제스처 등) 프리뷰만 정리
    const onCancel = (e: PointerEvent) => {
      if (!session || e.pointerId !== session.pointerId) return
      finish(false)
    }

    const onDown = (e: PointerEvent) => {
      // 손바닥·두 번째 손가락 같은 보조 터치는 무시 — 진행 중인 획을 죽이면 안 됨
      if (!e.isPrimary) return
      // 이전 up/cancel이 유실돼 세션이 남아 있으면(iOS의 간헐적 포인터 이벤트
      // 드랍 — InkCanvas에서 확인된 패턴) 버리고 새로 시작한다.
      // "한번 안 되면 계속 안 됨" 고착 방지.
      if (session) finish(false)
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
        intent: null,
        range: null,
        raf: 0,
        pendingPoint: null,
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
    }

    // iOS Safari는 touch-action: pan-y를 무시하거나 뒤늦게 pan으로 판정해
    // pointercancel로 칠하기를 끊는 경우가 있다 — 칠하기로 결정된 제스처의
    // touchmove는 직접 preventDefault해 스크롤 하이재킹을 차단한다(비-passive 필수).
    // 스크롤 판정이 시작되면 pointermove가 아예 안 올 수 있으므로,
    // 방향(intent) 결정도 touchmove에서 먼저 시도한다.
    const onTouchMove = (e: TouchEvent) => {
      if (!session) return
      if (!session.intent) {
        const touch = e.touches[0]
        if (!touch) return
        const dx = Math.abs(touch.clientX - session.startX)
        const dy = Math.abs(touch.clientY - session.startY)
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
        session.intent = dx >= dy ? 'paint' : 'scroll'
        if (session.intent === 'scroll') {
          finish(false)
          return
        }
      }
      if (session.intent === 'paint') e.preventDefault()
    }

    // 드래그 중 앱 전환·백그라운드 진입 시 세션이 고착되지 않게 정리
    const onHidden = () => {
      if (document.visibilityState === 'hidden') finish(false)
    }

    root.addEventListener('pointerdown', onDown)
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('visibilitychange', onHidden)
      detach()
      if (session?.raf) cancelAnimationFrame(session.raf)
      session = null
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
function ChapterDivider({ label }: { label: string }) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2" data-chapter-divider>
      <span className="shrink-0 font-serif text-xs font-bold tracking-wide text-rose-accent">
        {label}
      </span>
      <span aria-hidden className="h-px flex-1 bg-rose-line" />
    </div>
  )
}

function PassageText({
  chunks,
  startChapter = 1,
  highlightRanges,
  onApplyRanges,
  onRemoveRange,
  penColor,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const justDraggedRef = useRef(false)
  const blocks = useMemo(() => splitBlocks(chunks, startChapter), [chunks, startChapter])
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
          const divider = block.chapterLabel ? <ChapterDivider label={block.chapterLabel} /> : null

          if (block.type === 'heading') {
            return (
              <Fragment key={`heading-${block.text}-${index}`}>
                {divider}
                <h4 className="mb-1.5 mt-4 font-sans text-[0.82rem] font-black text-rose-ink first:mt-0">
                  {block.text}
                </h4>
              </Fragment>
            )
          }

          const parts = segmentParts(block.text, rangesByKey.get(block.verseKey))

          return (
            <Fragment key={`${block.label ?? 'intro'}-${index}`}>
              {divider}
              <p className="passage-segment">
                {block.label && <span className="passage-verse">{block.label}</span>}
                <span className="verse-body" data-vk={block.verseKey}>
                  {parts
                    ? parts.map((part, i) =>
                        part.color && part.range ? (
                          <span
                            key={i}
                            className={markClass(part.color)}
                            data-hl={`${part.range.start}-${part.range.end}`}
                            onClick={() => handleRemove(block.verseKey, part.range!)}
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
            </Fragment>
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
