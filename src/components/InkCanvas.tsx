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

// iPadOS Safari는 빠른 연속 필기에서 펜 "포인터" 이벤트를 간헐적으로 흘린다
// (커스텀 엔진·signature_pad 모두 동일 증상, 데스크톱은 정상 → 환경 문제).
// iOS에서는 1급 입력 경로인 네이티브 터치 이벤트(touchType 'stylus')로 획을 받고,
// 그 외 플랫폼은 포인터 이벤트를 쓴다.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1))

// 펜을 뗀 뒤에도 잠시 손바닥 터치를 계속 차단하는 유예(ms) — 연속 필기 중
// 획 사이에 손바닥이 끌리며 스크롤 제스처로 인식되면 다음 펜 입력을 삼킨다.
const PALM_GRACE_MS = 1200

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
  const activeTouchIdRef = useRef<number | null>(null)
  const detachWindowRef = useRef<(() => void) | null>(null)
  const palmGraceTimerRef = useRef<number | null>(null)
  const strokesRef = useRef(strokes)
  const propRef = useRef({ color, size, tool, onChange })

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
    // desynchronized(저지연) 힌트 금지 — Android 설치형(standalone) PWA에서는
    // 힌트가 실제 발동해 live 캔버스가 불투명 오버레이로 승격되고, 아래층
    // base 캔버스(확정 획)를 가려 "펜을 떼는 순간 글씨가 지워져 보이는" 문제를
    // 만든다(브라우저 탭·iOS Safari는 힌트를 무시해 정상으로 보였음).
    liveCtxRef.current = live.getContext('2d')
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
    // 자체 커밋(onChange)이 되돌아온 경우(같은 배열 참조)는 이미 증분 렌더됐으므로
    // 전체 획 재렌더(O(n))를 건너뛴다 — 획이 쌓일수록 획 사이 잔을 만들던 비용.
    if (strokesRef.current === strokes) return
    strokesRef.current = strokes
    renderBase()
  }, [strokes, renderBase])

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

  const holdPalmBlock = () => {
    if (palmGraceTimerRef.current !== null) {
      window.clearTimeout(palmGraceTimerRef.current)
      palmGraceTimerRef.current = null
    }
    document.body.classList.add('ink-active')
  }

  const releasePalmBlockSoon = () => {
    if (palmGraceTimerRef.current !== null) window.clearTimeout(palmGraceTimerRef.current)
    palmGraceTimerRef.current = window.setTimeout(() => {
      palmGraceTimerRef.current = null
      document.body.classList.remove('ink-active')
    }, PALM_GRACE_MS)
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

  // ── 공용 획 엔진 (포인터/터치 양쪽에서 호출) ──
  const beginAt = (clientX: number, clientY: number, pressure: number) => {
    const { tool, color, size } = propRef.current
    holdPalmBlock()

    // 이전 획의 up이 유실됐어도 버리지 말고 확정한 뒤 새로 시작
    if (drawingRef.current) commitDrawing()

    const [x, y, p] = getPoint(clientX, clientY, pressure)
    if (tool === 'eraser') {
      eraseAt(x, y)
      return
    }
    drawingRef.current = { color, size, points: [[x, y, p]] }
    renderLive()
  }

  const moveAt = (clientX: number, clientY: number, pressure: number) => {
    if (propRef.current.tool === 'eraser') {
      const [x, y] = getPoint(clientX, clientY, pressure)
      eraseAt(x, y)
      return
    }
    const drawing = drawingRef.current
    if (!drawing) return
    drawing.points.push(getPoint(clientX, clientY, pressure))
    renderLive()
  }

  const endStroke = () => {
    releasePalmBlockSoon()
    if (propRef.current.tool === 'eraser') return
    commitDrawing()
  }

  // ── 터치 엔진(iOS 전용): 펜 획을 네이티브 터치로 받는다 ──
  useEffect(() => {
    const canvas = liveRef.current
    if (!canvas) return

    type StylusTouch = Touch & { touchType?: string }

    const findStylus = (list: TouchList): StylusTouch | null => {
      for (let i = 0; i < list.length; i += 1) {
        const touch = list[i] as StylusTouch
        if (touch.touchType === 'stylus') return touch
      }
      return null
    }

    const findActive = (list: TouchList): Touch | null => {
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].identifier === activeTouchIdRef.current) return list[i]
      }
      return null
    }

    const onTouchStart = (event: TouchEvent) => {
      // 캔버스 위 네이티브 터치 제스처(더블탭 줌·콜아웃·스크롤)를 펜 포함 전부 차단.
      // 빠른 연속 펜 탭이 더블탭 후보로 잡혀 입력이 지연·유실되는 것을 막는다.
      event.preventDefault()
      if (!IS_IOS) return
      const stylus = findStylus(event.changedTouches)
      if (!stylus) return
      activeTouchIdRef.current = stylus.identifier
      rectRef.current = canvas.getBoundingClientRect()
      beginAt(stylus.clientX, stylus.clientY, stylus.force)
    }

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      if (!IS_IOS) return
      const touch = findActive(event.changedTouches)
      if (!touch) return
      moveAt(touch.clientX, touch.clientY, touch.force)
    }

    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault()
      if (!IS_IOS) return
      const touch = findActive(event.changedTouches)
      if (!touch) return
      activeTouchIdRef.current = null
      endStroke()
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false })

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
    // 핸들러는 전부 ref 기반이라 최초 등록분으로 충분하다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 손바닥 차단: 필기 중 + 유예 동안 문서 전체의 비-스타일러스 터치를 막는다.
  // 단, 실제로 그리는 중이 아니면 버튼 등 UI 탭은 허용한다.
  useEffect(() => {
    const isDrawingNow = () =>
      activePointerRef.current !== null || activeTouchIdRef.current !== null

    const preventDocumentPalmTouch = (event: TouchEvent) => {
      if (!document.body.classList.contains('ink-active')) return
      if (!isDrawingNow()) {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('button, input, select, textarea, a, [role="button"]')
        )
          return
      }
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
      document.removeEventListener('touchstart', preventDocumentPalmTouch, true)
      document.removeEventListener('touchmove', preventDocumentPalmTouch, true)
      document.removeEventListener('touchend', preventDocumentPalmTouch, true)
      document.removeEventListener('touchcancel', preventDocumentPalmTouch, true)
    }
  }, [])

  // ── 포인터 엔진(비-iOS) ──
  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (IS_IOS) return
    if (event.pointerType === 'touch') return

    event.preventDefault()
    detachWindowRef.current?.()

    const pointerId = event.pointerId
    activePointerRef.current = pointerId
    rectRef.current = event.currentTarget.getBoundingClientRect()
    beginAt(event.clientX, event.clientY, event.pressure)

    // setPointerCapture는 iOS Safari에서 캡처 미해제 시 이후 pointerdown까지
    // 막는 버그가 있어 쓰지 않는다. 대신 window에서 직접 추적해, 펜이 캔버스
    // 밖에서 떨어져도 up/cancel을 놓치지 않게 한다(획 유실·ink-active 고착 방지).
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (e.cancelable) e.preventDefault()

      const points =
        typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length
          ? e.getCoalescedEvents()
          : [e]
      for (const point of points) {
        moveAt(point.clientX, point.clientY, point.pressure)
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      detachWindowRef.current?.()
      detachWindowRef.current = null
      activePointerRef.current = null
      endStroke()
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

  // 획 도중 언마운트 시 window 리스너/유예 타이머/바디 클래스 정리
  useEffect(() => {
    return () => {
      detachWindowRef.current?.()
      detachWindowRef.current = null
      if (palmGraceTimerRef.current !== null) window.clearTimeout(palmGraceTimerRef.current)
      document.body.classList.remove('ink-active')
    }
  }, [])

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
