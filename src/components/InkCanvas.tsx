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

/**
 * perfect-freehand 외곽선을 캔버스에 채워 그린다.
 * - isLast=true: 끝점까지 채워 그림(끝 잘림 방지). 그리는 중엔 false.
 * - 점/아주 짧은 획은 점(원)으로 표시.
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
 * 손글씨 캔버스 (2겹: base=확정 획, live=진행 중·저지연).
 * ※ 현재 디버그 HUD가 켜져 있음 — 펜 입력 추적용(좌상단 표시).
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
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const baseCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const dimRef = useRef({ w: 0, h: height, dpr: 1 })
  const drawing = useRef<Stroke | null>(null)
  const activePointer = useRef<number | null>(null)
  const strokesRef = useRef(strokes)
  const propRef = useRef({ color, size, tool, onChange })

  // --- 디버그 계측(펜 입력 추적) ---
  const dbgRef = useRef({
    dn: 0, // pen/mouse 다운
    tch: 0, // touch(손가락/손바닥) 다운 — 거부됨
    mv: 0, // 반영된 이동
    rej: 0, // 무시된 이동(활성 포인터 불일치)
    up: 0,
    cx: 0, // pointercancel
    lost: 0, // lostpointercapture
    got: 0, // gotpointercapture
    lt: '', // 마지막 다운 포인터 종류
  })
  const hudRef = useRef<HTMLDivElement>(null)
  const hudRafRef = useRef<number | null>(null)
  const scheduleHud = useCallback(() => {
    if (hudRafRef.current != null) return
    hudRafRef.current = requestAnimationFrame(() => {
      hudRafRef.current = null
      const d = dbgRef.current
      const el = hudRef.current
      if (el)
        el.textContent =
          `dn${d.dn} tch${d.tch} mv${d.mv} rej${d.rej} up${d.up} cx${d.cx} lost${d.lost} got${d.got}\n` +
          `last:${d.lt} act:${activePointer.current} pts:${drawing.current?.points.length ?? 0} str:${strokesRef.current.length}`
    })
  }, [])

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  const renderBase = useCallback(() => {
    const ctx = baseCtxRef.current
    if (!ctx) return
    const { w, h, dpr } = dimRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (const s of strokesRef.current) fillStroke(ctx, s)
  }, [])

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

  // iOS: 손바닥/손가락 터치의 기본 동작(선택·콜아웃) 차단
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

  // 디버그: 포인터 캡처 상실/획득 추적
  useEffect(() => {
    const c = liveRef.current
    if (!c) return
    const onLost = () => {
      dbgRef.current.lost++
      scheduleHud()
    }
    const onGot = () => {
      dbgRef.current.got++
      scheduleHud()
    }
    c.addEventListener('lostpointercapture', onLost)
    c.addEventListener('gotpointercapture', onGot)
    return () => {
      c.removeEventListener('lostpointercapture', onLost)
      c.removeEventListener('gotpointercapture', onGot)
    }
  }, [scheduleHud])

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
    if (kept.length !== strokesRef.current.length) {
      strokesRef.current = kept
      onChange(kept)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { tool, color, size } = propRef.current
    dbgRef.current.lt = e.pointerType
    if (e.pointerType === 'touch') {
      dbgRef.current.tch++
      scheduleHud()
      return
    }
    dbgRef.current.dn++

    e.preventDefault()
    if (drawing.current) {
      drawing.current = null
      renderLive()
    }
    // setPointerCapture는 iOS Safari에서 캡처가 안 풀리면 이후 입력이 통째로 죽는
    // 버그가 있어 사용하지 않는다. (touch 기반 펜은 암묵적 캡처로 추적엔 충분)
    activePointer.current = e.pointerId
    rectRef.current = liveRef.current!.getBoundingClientRect()
    const [x, y, p] = getPoint(e.clientX, e.clientY, e.pressure)

    if (tool === 'eraser') {
      erase(x, y)
      scheduleHud()
      return
    }
    drawing.current = { points: [[x, y, p]], color, size }
    renderLive()
    scheduleHud()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) {
      dbgRef.current.rej++
      scheduleHud()
      return
    }
    const { tool } = propRef.current

    if (tool === 'eraser') {
      const [x, y] = getPoint(e.clientX, e.clientY, e.pressure)
      erase(x, y)
      return
    }
    if (!drawing.current) return

    const native = e.nativeEvent
    const batch =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
        ? native.getCoalescedEvents()
        : [native]
    for (const ev of batch) {
      drawing.current.points.push(getPoint(ev.clientX, ev.clientY, ev.pressure))
    }
    dbgRef.current.mv++
    renderLive()
    scheduleHud()
  }

  const finishStroke = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    if (propRef.current.tool === 'eraser') return
    if (!drawing.current) return
    const finished = drawing.current
    drawing.current = null
    if (finished.points.length > 0) {
      const bctx = baseCtxRef.current
      if (bctx) {
        const { dpr } = dimRef.current
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        fillStroke(bctx, finished)
      }
      renderLive()
      const next = [...strokesRef.current, finished]
      strokesRef.current = next
      propRef.current.onChange(next)
    } else {
      renderLive()
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    dbgRef.current.up++
    scheduleHud()
    finishStroke(e)
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    dbgRef.current.cx++
    scheduleHud()
    finishStroke(e)
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
        onPointerCancel={onPointerCancel}
      />
      <div
        ref={hudRef}
        className="pointer-events-none absolute left-1 top-1 z-10 whitespace-pre rounded bg-black/55 px-1.5 py-1 font-mono text-[10px] leading-tight text-lime-300"
      >
        펜 계측 대기…
      </div>
    </div>
  )
}
