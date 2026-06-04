import { useCallback, useEffect, useRef } from 'react'
import { getStroke } from 'perfect-freehand'
import type { Stroke } from '../types'

export type InkTool = 'pen' | 'eraser'

interface Props {
  strokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
  color: string
  size: number
  tool: InkTool
  /** 캔버스 높이(px) */
  height?: number
}

const FREEHAND_OPTS = {
  // 낮을수록 속도에 따른 굵기 변화가 적어 빠른 획도 또렷(흐려짐 방지)
  thinning: 0.4,
  smoothing: 0.5,
  // 낮을수록 선이 펜 끝을 빨리 따라온다(체감 입력 지연 감소)
  streamline: 0.3,
}

/**
 * perfect-freehand 외곽선을 캔버스에 채워 그린다.
 * - isLast=true: 획이 끝났으니 끝점까지 채워 그림(끝부분 잘림 방지). 그리는 중엔 false.
 * - 점/아주 짧은 획은 외곽선이 비므로 점(원)으로 찍어 표시(한글 짧은 획·점 인식).
 */
function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, isLast = true) {
  const outline = getStroke(stroke.points, {
    ...FREEHAND_OPTS,
    size: stroke.size,
    last: isLast,
  })
  ctx.fillStyle = stroke.color
  if (outline.length < 2) {
    const p0 = stroke.points[0]
    if (p0) {
      ctx.beginPath()
      ctx.arc(p0[0], p0[1], Math.max(stroke.size / 2, 1), 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1])
  }
  ctx.closePath()
  ctx.fill()
}

function distToStroke(stroke: Stroke, x: number, y: number): number {
  let min = Infinity
  for (const [px, py] of stroke.points) {
    const d = Math.hypot(px - x, py - y)
    if (d < min) min = d
  }
  return min
}

/**
 * 웹에서 가능한 최저지연 손글씨 캔버스.
 * - 2겹 캔버스: 아래(base)는 확정된 획, 위(live, 저지연)는 '지금 긋는 획'만.
 *   필기 중엔 위 캔버스에 현재 한 획만 다시 그리므로 매 입력 비용이 최소다.
 * - coalesced 이벤트로 펜의 고주파 입력을 빠짐없이 수집해 선이 자연스럽다.
 * - 좌표 변환용 rect는 획 시작 시 1회만 측정.
 * - 손가락/손바닥 터치는 거부(펜·마우스 전용), 지우개는 닿은 획을 통째로 지운다.
 */
export default function InkCanvas({
  strokes,
  onChange,
  color,
  size,
  tool,
  height = 240,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null) // 확정된 획
  const liveRef = useRef<HTMLCanvasElement>(null) // 진행 중인 획(저지연)
  const baseCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const dimRef = useRef({ w: 0, h: height, dpr: 1 })
  const drawing = useRef<Stroke | null>(null)
  // 현재 그리는 중인 포인터 ID (손바닥 멀티터치 차단용 — 하나만 허용)
  const activePointer = useRef<number | null>(null)
  const strokesRef = useRef(strokes)
  const propRef = useRef({ color, size, tool, onChange })

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  // 확정된 모든 획을 아래 캔버스에 렌더 (strokes가 바뀔 때만)
  const renderBase = useCallback(() => {
    const ctx = baseCtxRef.current
    if (!ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (const s of strokesRef.current) fillStroke(ctx, s)
  }, [])

  // 진행 중인 획만 위 캔버스에 렌더 (매 입력마다 — 가장 가벼움)
  const renderLive = useCallback(() => {
    const ctx = liveCtxRef.current
    if (!ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w * dpr, h * dpr)
    if (drawing.current) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fillStroke(ctx, drawing.current, false)
    }
  }, [])

  const resize = useCallback(() => {
    const base = baseRef.current
    const live = liveRef.current
    const wrap = wrapRef.current
    if (!base || !live || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = height
    dimRef.current = { w, h, dpr }
    for (const c of [base, live]) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    }
    baseCtxRef.current = base.getContext('2d')
    // 위 캔버스는 저지연 합성
    liveCtxRef.current = live.getContext('2d', { desynchronized: true })
    renderBase()
    renderLive()
  }, [height, renderBase, renderLive])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [resize])

  // iOS: 필기 중 손바닥/손가락이 캔버스에 닿으면 롱프레스로 인식돼
  // 선택·콜아웃 메뉴("링크 만들기" 등)가 뜬다. 터치 기본 동작을 막아 차단.
  useEffect(() => {
    const canvas = liveRef.current
    if (!canvas) return
    const prevent = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i] as Touch & { touchType?: string }
        if (t.touchType !== 'stylus') {
          e.preventDefault()
          return
        }
      }
    }
    canvas.addEventListener('touchstart', prevent, { passive: false })
    canvas.addEventListener('touchmove', prevent, { passive: false })
    canvas.addEventListener('touchend', prevent, { passive: false })
    return () => {
      canvas.removeEventListener('touchstart', prevent)
      canvas.removeEventListener('touchmove', prevent)
      canvas.removeEventListener('touchend', prevent)
    }
  }, [])

  // strokes가 외부에서 바뀌면(취소·전체지우기·로드) 아래 캔버스 갱신
  useEffect(() => {
    renderBase()
  }, [strokes, renderBase])

  const getPoint = (
    clientX: number,
    clientY: number,
    pressure: number,
  ): [number, number, number] => {
    const rect = rectRef.current ?? liveRef.current!.getBoundingClientRect()
    const p = pressure && pressure > 0 ? pressure : 0.5
    return [clientX - rect.left, clientY - rect.top, p]
  }

  const erase = (x: number, y: number) => {
    const { size, onChange } = propRef.current
    const threshold = Math.max(size, 12)
    const kept = strokesRef.current.filter((s) => distToStroke(s, x, y) > threshold)
    if (kept.length !== strokesRef.current.length) onChange(kept)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { tool, color, size } = propRef.current
    // 손글씨는 펜(과 마우스)으로만 — 손가락/손바닥 터치는 항상 거부
    if (e.pointerType === 'touch') return
    if (activePointer.current !== null) return

    e.preventDefault()
    activePointer.current = e.pointerId
    liveRef.current?.setPointerCapture(e.pointerId)
    // 획 동안 캔버스 위치는 고정 — 시작 시 1회만 측정
    rectRef.current = liveRef.current!.getBoundingClientRect()
    const [x, y, p] = getPoint(e.clientX, e.clientY, e.pressure)

    if (tool === 'eraser') {
      erase(x, y)
      return
    }
    drawing.current = { points: [[x, y, p]], color, size }
    renderLive()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    const { tool } = propRef.current

    if (tool === 'eraser') {
      const [x, y] = getPoint(e.clientX, e.clientY, e.pressure)
      erase(x, y)
      return
    }
    if (!drawing.current) return

    // 펜은 한 프레임에 여러 입력이 합쳐 들어온다(coalesced). 모두 반영해야 선이 매끄럽다.
    const native = e.nativeEvent
    const batch =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
        ? native.getCoalescedEvents()
        : [native]
    for (const ev of batch) {
      drawing.current.points.push(getPoint(ev.clientX, ev.clientY, ev.pressure))
    }
    renderLive()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    if (propRef.current.tool === 'eraser') return
    if (!drawing.current) return
    const finished = drawing.current
    drawing.current = null
    if (finished.points.length > 0) {
      // 확정: 아래 캔버스에 즉시 그리고 위 캔버스를 비운 뒤 영구 저장
      const bctx = baseCtxRef.current
      if (bctx) {
        const { dpr } = dimRef.current
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        fillStroke(bctx, finished)
      }
      renderLive() // drawing.current가 null이라 위 캔버스가 비워짐
      propRef.current.onChange([...strokesRef.current, finished])
    } else {
      renderLive()
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <canvas ref={baseRef} className="absolute inset-0 rounded-xl bg-white" />
      <canvas
        ref={liveRef}
        className="ink-surface absolute inset-0 rounded-xl"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
