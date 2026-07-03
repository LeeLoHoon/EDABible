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
  thinning: 0.4,
  smoothing: 0.5,
  streamline: 0.3,
}

function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, isLast = true) {
  const outline = getStroke(stroke.points, {
    ...FREEHAND_OPTS,
    size: stroke.size,
    last: isLast,
  })

  ctx.fillStyle = stroke.color

  if (outline.length < 2) {
    const point = stroke.points[0]
    if (!point) return
    ctx.beginPath()
    ctx.arc(point[0], point[1], Math.max(stroke.size / 2, 1), 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i += 1) {
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

export default function InkCanvas({
  strokes,
  onChange,
  color,
  size,
  tool,
  height = 240,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const baseCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const dimRef = useRef({ width: 0, height, dpr: 1 })
  const drawingRef = useRef<Stroke | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const detachWindowRef = useRef<(() => void) | null>(null)
  const strokesRef = useRef(strokes)
  const propRef = useRef({ color, size, tool, onChange })

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  const renderBase = useCallback(() => {
    const ctx = baseCtxRef.current
    if (!ctx) return
    const { width, height, dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    for (const stroke of strokesRef.current) fillStroke(ctx, stroke)
  }, [])

  const renderLive = useCallback(() => {
    const ctx = liveCtxRef.current
    if (!ctx) return
    const { width, height, dpr } = dimRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width * dpr, height * dpr)
    if (!drawingRef.current) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    fillStroke(ctx, drawingRef.current, false)
  }, [])

  const resize = useCallback(() => {
    const wrap = wrapRef.current
    const base = baseRef.current
    const live = liveRef.current
    if (!wrap || !base || !live) return

    const dpr = window.devicePixelRatio || 1
    const width = wrap.clientWidth
    dimRef.current = { width, height, dpr }

    for (const canvas of [base, live]) {
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    baseCtxRef.current = base.getContext('2d')
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

  useEffect(() => {
    renderBase()
  }, [strokes, renderBase])

  useEffect(() => {
    const canvas = liveRef.current
    if (!canvas) return

    const preventPalmTouch = (event: TouchEvent) => {
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        const touch = event.changedTouches[i] as Touch & { touchType?: string }
        if (touch.touchType !== 'stylus') {
          event.preventDefault()
          return
        }
      }
    }

    canvas.addEventListener('touchstart', preventPalmTouch, { passive: false })
    canvas.addEventListener('touchmove', preventPalmTouch, { passive: false })
    canvas.addEventListener('touchend', preventPalmTouch, { passive: false })
    canvas.addEventListener('touchcancel', preventPalmTouch, { passive: false })

    return () => {
      canvas.removeEventListener('touchstart', preventPalmTouch)
      canvas.removeEventListener('touchmove', preventPalmTouch)
      canvas.removeEventListener('touchend', preventPalmTouch)
      canvas.removeEventListener('touchcancel', preventPalmTouch)
    }
  }, [])

  useEffect(() => {
    const preventDocumentPalmTouch = (event: TouchEvent) => {
      if (!document.body.classList.contains('ink-active')) return
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        const touch = event.changedTouches[i] as Touch & { touchType?: string }
        if (touch.touchType !== 'stylus') {
          event.preventDefault()
          return
        }
      }
    }

    document.addEventListener('touchstart', preventDocumentPalmTouch, { passive: false, capture: true })
    document.addEventListener('touchmove', preventDocumentPalmTouch, { passive: false, capture: true })
    document.addEventListener('touchend', preventDocumentPalmTouch, { passive: false, capture: true })
    document.addEventListener('touchcancel', preventDocumentPalmTouch, { passive: false, capture: true })

    return () => {
      document.body.classList.remove('ink-active')
      document.removeEventListener('touchstart', preventDocumentPalmTouch, true)
      document.removeEventListener('touchmove', preventDocumentPalmTouch, true)
      document.removeEventListener('touchend', preventDocumentPalmTouch, true)
      document.removeEventListener('touchcancel', preventDocumentPalmTouch, true)
    }
  }, [])

  const getPoint = (clientX: number, clientY: number, pressure: number): [number, number, number] => {
    const rect = rectRef.current ?? liveRef.current!.getBoundingClientRect()
    return [clientX - rect.left, clientY - rect.top, pressure && pressure > 0 ? pressure : 0.5]
  }

  const eraseAt = (x: number, y: number) => {
    const { size, onChange } = propRef.current
    const threshold = Math.max(size, 12)
    const kept = strokesRef.current.filter((stroke) => distToStroke(stroke, x, y) > threshold)
    if (kept.length === strokesRef.current.length) return
    strokesRef.current = kept
    onChange(kept)
    renderBase()
  }

  // 진행 중인 획을 base 캔버스에 확정하고 strokes에 반영
  const commitDrawing = () => {
    const finished = drawingRef.current
    drawingRef.current = null

    if (!finished || finished.points.length === 0) {
      renderLive()
      return
    }

    const ctx = baseCtxRef.current
    if (ctx) {
      const { dpr } = dimRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      fillStroke(ctx, finished)
    }

    renderLive()

    const next = [...strokesRef.current, finished]
    strokesRef.current = next
    propRef.current.onChange(next)
  }

  const stopTracking = () => {
    detachWindowRef.current?.()
    detachWindowRef.current = null
    activePointerRef.current = null
    document.body.classList.remove('ink-active')
  }

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool, color, size } = propRef.current
    if (event.pointerType === 'touch') return

    event.preventDefault()

    // 이전 획의 up이 유실됐어도 버리지 말고 확정한 뒤 새로 시작
    stopTracking()
    if (drawingRef.current) commitDrawing()

    document.body.classList.add('ink-active')
    const pointerId = event.pointerId
    activePointerRef.current = pointerId
    rectRef.current = event.currentTarget.getBoundingClientRect()
    const [x, y, pressure] = getPoint(event.clientX, event.clientY, event.pressure)

    if (tool === 'eraser') {
      eraseAt(x, y)
    } else {
      drawingRef.current = { color, size, points: [[x, y, pressure]] }
      renderLive()
    }

    // setPointerCapture는 iOS Safari에서 캡처 미해제 시 이후 pointerdown까지
    // 막는 버그가 있어 쓰지 않는다. 대신 window에서 직접 추적해, 펜이 캔버스
    // 밖에서 떨어져도 up/cancel을 놓치지 않게 한다(획 유실·ink-active 고착 방지).
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (e.cancelable) e.preventDefault()

      if (propRef.current.tool === 'eraser') {
        const [ex, ey] = getPoint(e.clientX, e.clientY, e.pressure)
        eraseAt(ex, ey)
        return
      }

      const drawing = drawingRef.current
      if (!drawing) return

      const points =
        typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length
          ? e.getCoalescedEvents()
          : [e]
      for (const point of points) {
        drawing.points.push(getPoint(point.clientX, point.clientY, point.pressure))
      }
      renderLive()
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      stopTracking()
      if (propRef.current.tool === 'eraser') return
      commitDrawing()
    }

    window.addEventListener('pointermove', onMove, { capture: true })
    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('pointercancel', onUp, { capture: true })
    detachWindowRef.current = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }

  // 획 도중 언마운트되면 window 리스너/바디 클래스 정리
  useEffect(() => stopTracking, [])

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <canvas ref={baseRef} className="absolute inset-0 rounded-xl bg-white" />
      <canvas
        ref={liveRef}
        className="ink-surface absolute inset-0 rounded-xl"
        onPointerDown={startStroke}
      />
    </div>
  )
}
