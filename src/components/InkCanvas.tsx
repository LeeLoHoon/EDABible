import { useEffect, useRef } from 'react'
import SignaturePad, { type PointGroup } from 'signature_pad'
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

function minWidthFor(size: number) {
  return Math.max(size * 0.6, 0.3)
}

/** 내부 Stroke ↔ signature_pad PointGroup 변환 (기존 스키마/공유카드 호환 유지) */
function strokeToGroup(s: Stroke): PointGroup {
  return {
    penColor: s.color,
    dotSize: 0,
    minWidth: minWidthFor(s.size),
    maxWidth: s.size,
    velocityFilterWeight: 0.7,
    compositeOperation: 'source-over',
    points: s.points.map(([x, y, pressure], i) => ({ x, y, pressure: pressure ?? 0.5, time: i })),
  }
}

function groupToStroke(g: PointGroup): Stroke {
  return {
    color: g.penColor ?? '#3f3f46',
    size: g.maxWidth ?? 6,
    points: g.points.map((p) => [p.x, p.y, p.pressure ?? 0.5]),
  }
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
 * signature_pad 기반 손글씨 캔버스.
 * - 입력 이벤트 생명주기를 검증된 라이브러리가 관리(모바일 Safari 안정성).
 * - 손가락/손바닥 터치는 래퍼 capture 단계에서 차단(펜 전용).
 * - 데이터는 기존 Stroke[] 스키마로 변환 저장 → 기존 기록·공유카드 호환.
 * - 지우개는 닿은 획을 통째로 지움(라이브러리 off + 자체 처리).
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const propRef = useRef({ color, size, tool, onChange })
  const strokesRef = useRef(strokes)
  const lastDataRef = useRef<Stroke[]>(strokes) // 우리가 마지막으로 동기화한 strokes 참조

  useEffect(() => {
    propRef.current = { color, size, tool, onChange }
  }, [color, size, tool, onChange])

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  // signature_pad 생성(1회)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePad(canvas, {
      penColor: propRef.current.color,
      minWidth: minWidthFor(propRef.current.size),
      maxWidth: propRef.current.size,
      velocityFilterWeight: 0.7,
      throttle: 0, // 이동마다 즉시 그림(반응 지연 감소)
      minDistance: 1, // 더 촘촘히 점을 받음(반응·정밀도 향상)
    })
    padRef.current = pad
    pad.fromData(strokesRef.current.map(strokeToGroup))
    lastDataRef.current = strokesRef.current

    const onEnd = () => {
      const next = pad.toData().map(groupToStroke)
      strokesRef.current = next
      lastDataRef.current = next
      propRef.current.onChange(next)
    }
    pad.addEventListener('endStroke', onEnd)
    return () => {
      pad.removeEventListener('endStroke', onEnd)
      pad.off()
      padRef.current = null
    }
  }, [])

  // 크기/DPR 동기화(데이터 보존). height 변경·컨테이너 리사이즈 대응.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const resize = () => {
      const pad = padRef.current
      if (!pad) return
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const data = pad.toData()
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr) // canvas.width 설정으로 변환 초기화됨 → 1회 scale
      pad.fromData(data)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [height])

  // 펜 색/굵기 → 새 획에 반영
  useEffect(() => {
    const pad = padRef.current
    if (!pad) return
    pad.penColor = color
    pad.minWidth = minWidthFor(size)
    pad.maxWidth = size
  }, [color, size])

  // 외부에서 strokes 변경(취소·전체지우기·로드) → 다시 로드. 우리가 만든 변경이면 스킵.
  useEffect(() => {
    const pad = padRef.current
    if (!pad) return
    if (strokes === lastDataRef.current) return
    lastDataRef.current = strokes
    strokesRef.current = strokes
    pad.fromData(strokes.map(strokeToGroup))
  }, [strokes])

  // 손가락 차단(펜 전용) + 지우개 처리: 래퍼 capture 단계에서 가로챈다.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let erasing: number | null = null

    const eraseAt = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      const pad = padRef.current
      if (!canvas || !pad) return
      const rect = canvas.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const { size, onChange } = propRef.current
      const threshold = Math.max(size, 14)
      const kept = strokesRef.current.filter((s) => distToStroke(s, x, y) > threshold)
      if (kept.length !== strokesRef.current.length) {
        strokesRef.current = kept
        lastDataRef.current = kept
        pad.fromData(kept.map(strokeToGroup))
        onChange(kept)
      }
    }
    const move = (e: PointerEvent) => {
      if (erasing === e.pointerId) eraseAt(e.clientX, e.clientY)
    }
    const up = (e: PointerEvent) => {
      if (erasing !== e.pointerId) return
      erasing = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    const downCapture = (e: PointerEvent) => {
      // 손가락/손바닥은 항상 차단 — signature_pad에 도달하지 못하게 capture에서 중단
      if (e.pointerType === 'touch') {
        e.stopPropagation()
        if (e.cancelable) e.preventDefault()
        return
      }
      // 지우개 모드: 펜도 라이브러리에 넘기지 않고 직접 지움
      if (propRef.current.tool === 'eraser') {
        e.stopPropagation()
        if (e.cancelable) e.preventDefault()
        erasing = e.pointerId
        eraseAt(e.clientX, e.clientY)
        window.addEventListener('pointermove', move, { passive: false })
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }
      // 펜 + 펜 모드 → 그대로 signature_pad가 처리
    }
    wrap.addEventListener('pointerdown', downCapture, true)
    return () => {
      wrap.removeEventListener('pointerdown', downCapture, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="ink-surface w-full rounded-xl bg-white"
        style={{ height, touchAction: 'none' }}
      />
    </div>
  )
}
