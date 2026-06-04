import { useCallback, useEffect, useRef, useState } from 'react'
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

/** perfect-freehand 외곽선을 채워 그린다. 점/짧은 획은 원으로. */
function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, isLast = true) {
  const outline = getStroke(stroke.points, { ...FREEHAND_OPTS, size: stroke.size, last: isLast })
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
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1])
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
 * 손글씨 캔버스.
 * - 확정된 획은 오프스크린 버퍼에 캐싱 → 이동마다 비용 O(1)(전체 재그리기 없음).
 * - 확정 시 버퍼에 그 획만 추가 → 획당 비용도 O(1). (전체 재렌더는 외부 변경 때만)
 * - setPointerCapture / desynchronized / 네이티브 터치 차단은 사용하지 않음(iOS 먹통 회피).
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
  const bufferRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef<Stroke | null>(null)
  const activePointer = useRef<number | null>(null)
  const strokesRef = useRef(strokes)
  const syncedRef = useRef(strokes) // 버퍼에 반영된 마지막 strokes 참조
  const propRef = useRef({ color, size, tool, onChange })
  const dimRef = useRef({ w: 0, h: height, dpr: 1 })
  const rectRef = useRef<DOMRect | null>(null)

  // 디버그 HUD (React 상태)
  const cnt = useRef({ dn: 0, tch: 0, mv: 0, up: 0, cx: 0 })
  const [dbg, setDbg] = useState('대기')
  const hud = () => {
    const c = cnt.current
    setDbg(
      `dn${c.dn} tch${c.tch} mv${c.mv} up${c.up} cx${c.cx} act:${activePointer.current} str:${strokesRef.current.length}`,
    )
  }

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  // 확정된 모든 획을 버퍼에 다시 렌더 (외부 변경 때만 — O(n))
  const renderBuffer = useCallback(() => {
    const buffer = bufferRef.current
    const ctx = buffer?.getContext('2d')
    if (!buffer || !ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (const s of strokesRef.current) fillStroke(ctx, s)
  }, [])

  // 화면 = 버퍼 + 진행 중인 획 (이동마다 — O(1))
  const redraw = useCallback(() => {
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
    redraw()
  }, [height, renderBuffer, redraw])

  useEffect(() => {
    resize()
    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [resize])

  // strokes 변경 반영: 우리가 그린 것이면 버퍼 이미 최신 → 스킵, 외부 변경이면 전체 재렌더
  useEffect(() => {
    strokesRef.current = strokes
    if (strokes !== syncedRef.current) {
      syncedRef.current = strokes
      renderBuffer()
      redraw()
    }
  }, [strokes, renderBuffer, redraw])

  const getPoint = (
    clientX: number,
    clientY: number,
    pressure: number,
  ): [number, number, number] => {
    const rect = rectRef.current ?? canvasRef.current!.getBoundingClientRect()
    const p = pressure && pressure > 0 ? pressure : 0.5
    return [clientX - rect.left, clientY - rect.top, p]
  }

  const erase = (x: number, y: number) => {
    const { size, onChange } = propRef.current
    const threshold = Math.max(size, 12)
    const kept = strokesRef.current.filter((s) => distToStroke(s, x, y) > threshold)
    if (kept.length !== strokesRef.current.length) {
      strokesRef.current = kept
      syncedRef.current = kept
      renderBuffer()
      redraw()
      onChange(kept)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { tool, color, size } = propRef.current
    if (e.pointerType === 'touch') {
      cnt.current.tch++
      hud()
      return
    }
    cnt.current.dn++
    hud()

    e.preventDefault()
    drawing.current = null
    activePointer.current = e.pointerId
    rectRef.current = canvasRef.current!.getBoundingClientRect()
    const [x, y, p] = getPoint(e.clientX, e.clientY, e.pressure)

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
    const [x, y] = getPoint(e.clientX, e.clientY, e.pressure)

    if (tool === 'eraser') {
      erase(x, y)
      return
    }
    if (!drawing.current) return
    drawing.current.points.push([x, y, e.pressure && e.pressure > 0 ? e.pressure : 0.5])
    cnt.current.mv++
    redraw()
  }

  const end = (e: React.PointerEvent, cancel: boolean) => {
    if (cancel) cnt.current.cx++
    else cnt.current.up++
    hud()
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    if (propRef.current.tool === 'eraser') return
    if (!drawing.current) return
    const finished = drawing.current
    drawing.current = null
    if (finished.points.length > 0) {
      // 확정 획만 버퍼에 추가(O(1)) — 전체 재렌더 안 함
      const bctx = bufferRef.current?.getContext('2d')
      if (bctx) {
        const { dpr } = dimRef.current
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        fillStroke(bctx, finished)
      }
      const next = [...strokesRef.current, finished]
      strokesRef.current = next
      syncedRef.current = next // 버퍼 직접 갱신함 → strokes effect에서 전체 재렌더 스킵
      redraw()
      propRef.current.onChange(next)
    } else {
      redraw()
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="ink-surface w-full rounded-xl bg-white"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
      />
      <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-lime-300">
        {dbg}
      </div>
    </div>
  )
}
