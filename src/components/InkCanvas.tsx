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
  thinning: 0.5,
  smoothing: 0.42,
  // 낮을수록 실제 펜 궤적을 충실히 따라간다(코너 잘림 방지 → 동그라미가 잘 닫힘)
  streamline: 0.32,
}

/** perfect-freehand 외곽선을 캔버스에 채워 그린다. isLast=false면 아직 그리는 중(끝 캡 미완성) */
function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, isLast = true) {
  const outline = getStroke(stroke.points, {
    ...FREEHAND_OPTS,
    size: stroke.size,
    last: isLast,
  })
  if (outline.length < 2) return
  ctx.fillStyle = stroke.color
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
 * Apple Pencil / S Pen 필압을 지원하는 손글씨 캔버스.
 * - 확정된 획은 오프스크린 버퍼에 캐싱해, 글자가 쌓여도 매 프레임 전체 재그리기 없이 부드럽게 유지.
 * - 펜의 고주파 입력(coalesced events)을 빠짐없이 반영해 빠르게 써도 선이 끊기지 않는다.
 * - 포인트는 CSS 픽셀 좌표로 저장하고, devicePixelRatio로 선명하게 렌더한다.
 * - 지우개는 '획 단위' — 닿은 획을 통째로 지운다.
 */
export default function InkCanvas({
  strokes,
  onChange,
  color,
  size,
  tool,
  height = 240,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 확정된 획을 캐싱하는 오프스크린 버퍼
  const bufferRef = useRef<HTMLCanvasElement | null>(null)
  // 현재 캔버스 CSS 크기 / dpr
  const dimRef = useRef({ w: 0, h: height, dpr: 1 })
  const drawing = useRef<Stroke | null>(null)
  // 현재 그리는 중인 포인터 ID (손바닥 멀티터치 차단용 — 하나만 허용)
  const activePointer = useRef<number | null>(null)
  // 다음 페인트 예약(raf) 핸들
  const rafRef = useRef<number | null>(null)
  // 최신 props를 이벤트 핸들러에서 참조하기 위한 ref
  const strokesRef = useRef(strokes)
  const propRef = useRef({ color, size, tool, onChange })

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  // 확정된 모든 획을 버퍼에 다시 렌더
  const renderBuffer = useCallback(() => {
    const buffer = bufferRef.current
    const ctx = buffer?.getContext('2d')
    if (!buffer || !ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (const s of strokesRef.current) fillStroke(ctx, s, true)
  }, [])

  // 화면 = 버퍼(확정 획) + 진행 중인 획 합성
  const paint = useCallback(() => {
    rafRef.current = null
    const canvas = canvasRef.current
    const buffer = bufferRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !buffer || !ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w * dpr, h * dpr)
    ctx.drawImage(buffer, 0, 0)
    if (drawing.current) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fillStroke(ctx, drawing.current, false)
    }
  }, [])

  const schedulePaint = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(paint)
  }, [paint])

  // 확정된 획 하나를 버퍼에 즉시 합성(획을 뗄 때 깜빡임 방지)
  const commitToBuffer = useCallback((stroke: Stroke) => {
    const buffer = bufferRef.current
    const ctx = buffer?.getContext('2d')
    if (!buffer || !ctx) return
    const { dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    fillStroke(ctx, stroke, true)
  }, [])

  // 캔버스/버퍼 크기를 컨테이너에 맞추고 DPR 적용
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = height
    dimRef.current = { w, h, dpr }
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    if (!bufferRef.current) bufferRef.current = document.createElement('canvas')
    bufferRef.current.width = canvas.width
    bufferRef.current.height = canvas.height
    renderBuffer()
    paint()
  }, [height, renderBuffer, paint])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [resize])

  // 언마운트 시 예약된 페인트 정리
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  // iOS: 필기 중 손바닥/손가락이 캔버스에 닿으면 롱프레스로 인식돼
  // 선택·콜아웃 메뉴("링크 만들기" 등)가 뜬다. 터치 기본 동작을 막아 차단.
  // (펜은 pointer 이벤트로 처리하므로 필기에는 영향 없음)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const prevent = (e: TouchEvent) => {
      // 펜(stylus)이 아닌 터치(손바닥·손가락)만 차단 — 펜 필기는 그대로 통과
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

  // 외부에서 strokes가 바뀌면(취소·전체지우기·로드) 버퍼 갱신 후 다시 그림
  useEffect(() => {
    renderBuffer()
    paint()
  }, [strokes, renderBuffer, paint])

  const pointAt = (
    clientX: number,
    clientY: number,
    pressure: number,
  ): [number, number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const p = pressure && pressure > 0 ? pressure : 0.5
    return [clientX - rect.left, clientY - rect.top, p]
  }

  const erase = (x: number, y: number) => {
    const { size, onChange } = propRef.current
    const threshold = Math.max(size, 14)
    const kept = strokesRef.current.filter((s) => distToStroke(s, x, y) > threshold)
    if (kept.length !== strokesRef.current.length) onChange(kept)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { tool, color, size } = propRef.current
    // 손글씨는 펜(과 마우스)으로만 — 손가락/손바닥 터치는 항상 거부
    if (e.pointerType === 'touch') return
    // 이미 다른 포인터가 그리는 중이면 무시 (필기 중 손바닥 닿음)
    if (activePointer.current !== null) return

    e.preventDefault()
    activePointer.current = e.pointerId
    canvasRef.current?.setPointerCapture(e.pointerId)
    const [x, y, p] = pointAt(e.clientX, e.clientY, e.pressure)

    if (tool === 'eraser') {
      erase(x, y)
      return
    }
    drawing.current = { points: [[x, y, p]], color, size }
    schedulePaint()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    const { tool } = propRef.current

    if (tool === 'eraser') {
      const [x, y] = pointAt(e.clientX, e.clientY, e.pressure)
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
      drawing.current.points.push(pointAt(ev.clientX, ev.clientY, ev.pressure))
    }
    schedulePaint()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    canvasRef.current?.releasePointerCapture?.(e.pointerId)
    if (propRef.current.tool === 'eraser') return
    if (!drawing.current) return
    const finished = drawing.current
    drawing.current = null
    if (finished.points.length > 0) {
      // 버퍼에 즉시 합성해 깜빡임 없이 확정한 뒤 저장
      commitToBuffer(finished)
      paint()
      propRef.current.onChange([...strokesRef.current, finished])
    } else {
      paint()
    }
  }

  return (
    <div ref={wrapRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="ink-surface w-full rounded-xl bg-white"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
