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
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
}

/** perfect-freehand 외곽선을 캔버스에 채워 그린다 */
function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const outline = getStroke(stroke.points, { ...FREEHAND_OPTS, size: stroke.size })
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
 * 포인트는 CSS 픽셀 좌표로 저장하고, devicePixelRatio로 선명하게 렌더한다.
 * 지우개는 '획 단위' — 닿은 획을 통째로 지운다.
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
  const drawing = useRef<Stroke | null>(null)
  // 현재 그리는 중인 포인터 ID (손바닥 멀티터치 차단용 — 하나만 허용)
  const activePointer = useRef<number | null>(null)
  // 최신 props를 이벤트 핸들러에서 참조하기 위한 ref
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const propRef = useRef({ color, size, tool, onChange })
  propRef.current = { color, size, tool, onChange }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    for (const s of strokesRef.current) fillStroke(ctx, s)
    if (drawing.current) fillStroke(ctx, drawing.current)
    ctx.restore()
  }, [])

  // 캔버스 크기를 컨테이너에 맞추고 DPR 적용
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    redraw()
  }, [height, redraw])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [resize])

  // strokes가 외부에서 바뀌면 다시 그림
  useEffect(() => {
    redraw()
  }, [strokes, redraw])

  const getPoint = (e: React.PointerEvent): [number, number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5
    return [e.clientX - rect.left, e.clientY - rect.top, pressure]
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
    // 이미 다른 포인터가 그리는 중이면 무시 (필기 중 손바닥 닿음)
    if (activePointer.current !== null) return

    e.preventDefault()
    activePointer.current = e.pointerId
    canvasRef.current?.setPointerCapture(e.pointerId)
    const [x, y, p] = getPoint(e)

    if (tool === 'eraser') {
      erase(x, y)
      return
    }
    drawing.current = { points: [[x, y, p]], color, size }
    redraw()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    const { tool } = propRef.current
    const [x, y] = getPoint(e)

    if (tool === 'eraser') {
      erase(x, y)
      return
    }
    if (!drawing.current) return
    drawing.current.points.push([x, y, e.pressure && e.pressure > 0 ? e.pressure : 0.5])
    redraw()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    if (propRef.current.tool === 'eraser') return
    if (!drawing.current) return
    const finished = drawing.current
    drawing.current = null
    if (finished.points.length > 0) {
      propRef.current.onChange([...strokesRef.current, finished])
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
