import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useAuth } from '../authState'
import { binderBooks, binderUrl } from '../binderLibrary'
import ModeToggle from '../components/ModeToggle'
import {
  getBinderWork,
  getLastBinderBookId,
  putBinderWork,
  type BinderBookmark,
  type BinderTextBox,
  type BinderWork,
} from '../db'
import { emptyField, type Field, type FieldMode, type Stroke } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
type InkTool = 'pen' | 'eraser'

const PEN_COLORS = ['#2c2722', '#b25c30', '#2563eb', '#059669', '#be185d']

// iPadOS Safari는 빠른 연속 필기에서 펜 "포인터" 이벤트를 간헐적으로 흘리므로
// (노트 앱과 동일한 교훈) iOS에서는 네이티브 터치 이벤트(touchType 'stylus')로
// 획을 받고, 그 외 플랫폼은 포인터 이벤트를 쓴다. setPointerCapture는 iOS에서
// 캡처 미해제 시 이후 pointerdown까지 막는 버그가 있어 쓰지 않는다.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1))

// 펜을 뗀 뒤에도 잠시 손바닥 터치를 계속 차단하는 유예(ms)
const PALM_GRACE_MS = 1200

interface BinderCheckpoint {
  id: string
  label: string
  page: number
}

function defaultCheckpoints(bookId: string): BinderCheckpoint[] {
  if (bookId === 'spl-00-01') {
    return [
      { id: 'cover', label: '표지', page: 1 },
      { id: 'starter-00', label: '00 목차', page: 7 },
      { id: 'accept-prayer', label: '영접 기도', page: 53 },
      { id: 'starter-01', label: '01 목차', page: 57 },
      { id: 'strength', label: '강점 찾기', page: 59 },
      { id: 'mission', label: '사명 찾기', page: 63 },
      { id: 'eda-prayer', label: '에다 기도문', page: 71 },
      { id: 'deliverance', label: '축사 기도문', page: 95 },
      { id: 'meditation', label: '성경묵상', page: 113 },
      { id: 'timothy', label: '디모데 만들기', page: 151 },
      { id: 'book-study', label: '책공부', page: 163 },
    ]
  }

  return [
    { id: 'cover', label: '표지', page: 1 },
    { id: 'toc', label: '목차', page: 5 },
    { id: 'meditation', label: '성경묵상', page: 7 },
    { id: 'timothy', label: '디모데 만들기', page: 43 },
    { id: 'book-study', label: '책공부', page: 55 },
  ]
}

function nearbyPages(pageNumber: number, pageCount: number, count = 5): number[] {
  const clamped = Math.max(1, Math.min(pageCount, pageNumber))
  const limit = Math.min(count, pageCount)
  const half = Math.floor(count / 2)
  const pages = new Set<number>()

  for (let page = clamped - half; page <= clamped + half; page += 1) {
    if (page >= 1 && page <= pageCount) pages.add(page)
  }

  for (let page = clamped + half + 1; pages.size < limit && page <= pageCount; page += 1) {
    pages.add(page)
  }

  for (let page = clamped - half - 1; pages.size < limit && page >= 1; page -= 1) {
    pages.add(page)
  }

  return [...pages].sort((a, b) => a - b)
}

function distToStroke(stroke: Stroke, x: number, y: number): number {
  let min = Infinity
  for (const [px, py] of stroke.points) {
    const d = Math.hypot(px - x, py - y)
    if (d < min) min = d
  }
  return min
}

function drawStrokes(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pixelRatio = Number(canvas.dataset.pixelRatio || 1)
  const rect = canvas.getBoundingClientRect()
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.size
    ctx.beginPath()
    const [firstX, firstY] = stroke.points[0]
    ctx.moveTo(firstX, firstY)
    for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x, y)
    if (stroke.points.length === 1) {
      ctx.arc(firstX, firstY, stroke.size / 2, 0, Math.PI * 2)
      ctx.fillStyle = stroke.color
      ctx.fill()
    } else {
      ctx.stroke()
    }
  }
}

function PageOverlay({
  field,
  textBoxes,
  mode,
  onChange,
  onTextBoxesChange,
}: {
  field: Field
  textBoxes: BinderTextBox[]
  mode: FieldMode
  onChange: (field: Field) => void
  onTextBoxesChange: (boxes: BinderTextBox[]) => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef<Stroke | null>(null)
  const activePointerRef = useRef<number | null>(null)
  const activeTouchIdRef = useRef<number | null>(null)
  const detachWindowRef = useRef<(() => void) | null>(null)
  const palmGraceTimerRef = useRef<number | null>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const fieldRef = useRef(field)
  const textBoxesRef = useRef(textBoxes)
  const [tool, setTool] = useState<InkTool>('pen')
  const [color, setColor] = useState(PEN_COLORS[0])
  const [size, setSize] = useState(4)
  // 터치 엔진은 최초 1회만 등록되므로 최신 값은 ref로 읽는다
  const inkPropsRef = useRef({ tool, color, size, mode, onChange })

  useEffect(() => {
    inkPropsRef.current = { tool, color, size, mode, onChange }
  }, [tool, color, size, mode, onChange])
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(textBoxes[0]?.id ?? null)
  const visibleActiveTextBoxId = textBoxes.some((box) => box.id === activeTextBoxId)
    ? activeTextBoxId
    : (textBoxes[0]?.id ?? null)

  useEffect(() => {
    fieldRef.current = field
    const canvas = canvasRef.current
    if (!canvas) return
    // 진행 중 획이 있으면 함께 그린다 (필기 도중 저장 재렌더로 획이 사라지지 않게)
    const live = drawingRef.current
    drawStrokes(canvas, live ? [...field.strokes, live] : field.strokes)
  }, [field])

  useEffect(() => {
    textBoxesRef.current = textBoxes
  }, [textBoxes])

  useEffect(() => {
    if (textBoxes.length > 0 || !field.text.trim()) return
    const box = {
      id: crypto.randomUUID(),
      x: 0.08,
      y: 0.08,
      width: 0.52,
      text: field.text,
    }
    onTextBoxesChange([box])
    onChange({ ...field, text: '' })
    window.setTimeout(() => setActiveTextBoxId(box.id), 0)
  }, [field, onChange, onTextBoxesChange, textBoxes.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const syncSize = () => {
      const rect = canvas.getBoundingClientRect()
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
      canvas.dataset.pixelRatio = String(pixelRatio)
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio))
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio))
      drawStrokes(canvas, fieldRef.current.strokes)
    }
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const live = drawingRef.current
    drawStrokes(canvas, live ? [...fieldRef.current.strokes, live] : fieldRef.current.strokes)
  }

  const eraseAt = (x: number, y: number) => {
    const threshold = Math.max(inkPropsRef.current.size * 2, 18)
    const kept = fieldRef.current.strokes.filter((stroke) => distToStroke(stroke, x, y) > threshold)
    if (kept.length === fieldRef.current.strokes.length) return
    const next = { ...fieldRef.current, strokes: kept }
    fieldRef.current = next
    inkPropsRef.current.onChange(next)
    redraw()
  }

  const holdPalmBlock = () => {
    if (palmGraceTimerRef.current !== null) {
      window.clearTimeout(palmGraceTimerRef.current)
      palmGraceTimerRef.current = null
    }
    window.document.body.classList.add('ink-active')
  }

  const releasePalmBlockSoon = () => {
    if (palmGraceTimerRef.current !== null) window.clearTimeout(palmGraceTimerRef.current)
    palmGraceTimerRef.current = window.setTimeout(() => {
      palmGraceTimerRef.current = null
      window.document.body.classList.remove('ink-active')
    }, PALM_GRACE_MS)
  }

  // 진행 중인 획을 확정해 저장 흐름(onChange)으로 넘긴다
  const commitDrawing = () => {
    const stroke = drawingRef.current
    drawingRef.current = null
    if (!stroke || stroke.points.length === 0) {
      redraw()
      return
    }
    const next = { ...fieldRef.current, strokes: [...fieldRef.current.strokes, stroke] }
    fieldRef.current = next
    inkPropsRef.current.onChange(next)
    redraw()
  }

  // ── 공용 획 엔진 (포인터/터치 양쪽에서 호출, ref만 사용) ──
  const beginAt = (clientX: number, clientY: number, pressure: number) => {
    const { tool, color, size } = inkPropsRef.current
    holdPalmBlock()
    // 이전 획의 up이 유실됐어도 버리지 말고 확정한 뒤 새로 시작
    if (drawingRef.current) commitDrawing()

    const rect = rectRef.current
    if (!rect) return
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (tool === 'eraser') {
      eraseAt(x, y)
      return
    }
    drawingRef.current = { color, size, points: [[x, y, pressure && pressure > 0 ? pressure : 0.5]] }
    redraw()
  }

  const moveAt = (clientX: number, clientY: number, pressure: number) => {
    const rect = rectRef.current
    if (!rect) return
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (inkPropsRef.current.tool === 'eraser') {
      eraseAt(x, y)
      return
    }
    const stroke = drawingRef.current
    if (!stroke) return
    stroke.points.push([x, y, pressure && pressure > 0 ? pressure : 0.5])
    redraw()
  }

  const finishStroke = () => {
    releasePalmBlockSoon()
    if (inkPropsRef.current.tool === 'eraser') return
    commitDrawing()
  }

  // ── 포인터 엔진(비-iOS): window에서 직접 추적해 캔버스 밖 up도 놓치지 않는다 ──
  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (inkPropsRef.current.mode !== 'ink') return
    if (IS_IOS) return
    if (event.pointerType === 'touch') return

    event.preventDefault()
    detachWindowRef.current?.()

    const pointerId = event.pointerId
    activePointerRef.current = pointerId
    rectRef.current = event.currentTarget.getBoundingClientRect()
    beginAt(event.clientX, event.clientY, event.pressure)

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (e.cancelable) e.preventDefault()
      const points =
        typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length
          ? e.getCoalescedEvents()
          : [e]
      for (const point of points) moveAt(point.clientX, point.clientY, point.pressure)
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      detachWindowRef.current?.()
      detachWindowRef.current = null
      activePointerRef.current = null
      finishStroke()
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

  // ── 터치 엔진(iOS 전용): 펜 획을 네이티브 터치(touchType 'stylus')로 받는다 ──
  useEffect(() => {
    const canvas = canvasRef.current
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
      // 캔버스 위 네이티브 제스처(더블탭 줌·콜아웃·스크롤)를 펜 포함 전부 차단
      event.preventDefault()
      if (!IS_IOS || inkPropsRef.current.mode !== 'ink') return
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
      finishStroke()
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
      if (!window.document.body.classList.contains('ink-active')) return
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

    window.document.addEventListener('touchstart', preventDocumentPalmTouch, { passive: false, capture: true })
    window.document.addEventListener('touchmove', preventDocumentPalmTouch, { passive: false, capture: true })
    window.document.addEventListener('touchend', preventDocumentPalmTouch, { passive: false, capture: true })
    window.document.addEventListener('touchcancel', preventDocumentPalmTouch, { passive: false, capture: true })

    return () => {
      window.document.removeEventListener('touchstart', preventDocumentPalmTouch, true)
      window.document.removeEventListener('touchmove', preventDocumentPalmTouch, true)
      window.document.removeEventListener('touchend', preventDocumentPalmTouch, true)
      window.document.removeEventListener('touchcancel', preventDocumentPalmTouch, true)
    }
  }, [])

  // 획 도중 언마운트 시 window 리스너/유예 타이머/바디 클래스 정리
  useEffect(() => {
    return () => {
      detachWindowRef.current?.()
      detachWindowRef.current = null
      if (palmGraceTimerRef.current !== null) window.clearTimeout(palmGraceTimerRef.current)
      window.document.body.classList.remove('ink-active')
    }
  }, [])

  const undo = () => {
    const next = { ...fieldRef.current, strokes: fieldRef.current.strokes.slice(0, -1) }
    fieldRef.current = next
    onChange(next)
  }

  const clear = () => {
    const next = { ...fieldRef.current, strokes: [] }
    fieldRef.current = next
    onChange(next)
  }

  const addTextBox = (event: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'text') return
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(0.78, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(0.92, (event.clientY - rect.top) / rect.height))
    const box = {
      id: crypto.randomUUID(),
      x,
      y,
      width: 0.34,
      text: '',
    }
    onTextBoxesChange([...textBoxesRef.current, box])
    setActiveTextBoxId(box.id)
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>(`[data-text-box-id="${box.id}"]`)?.focus()
    }, 0)
  }

  const updateTextBox = (id: string, patch: Partial<BinderTextBox>) => {
    onTextBoxesChange(textBoxesRef.current.map((box) => (box.id === id ? { ...box, ...patch } : box)))
  }

  const startMoveTextBox = (event: React.PointerEvent<HTMLButtonElement>, box: BinderTextBox) => {
    const overlay = overlayRef.current
    if (!overlay) return
    event.preventDefault()
    event.stopPropagation()
    setActiveTextBoxId(box.id)

    const rect = overlay.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const originX = box.x
    const originY = box.y

    const move = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      const nextX = Math.max(0, Math.min(0.94 - box.width, originX + (moveEvent.clientX - startX) / rect.width))
      const nextY = Math.max(0, Math.min(0.94, originY + (moveEvent.clientY - startY) / rect.height))
      updateTextBox(box.id, { x: nextX, y: nextY })
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const deleteTextBox = (id: string) => {
    const next = textBoxesRef.current.filter((box) => box.id !== id)
    onTextBoxesChange(next)
    setActiveTextBoxId(next[0]?.id ?? null)
  }

  return (
    <div ref={overlayRef} className="absolute inset-0" onClick={addTextBox}>
      {mode === 'text' && (
        <>
          {textBoxes.map((box) => {
            const active = visibleActiveTextBoxId === box.id
            return (
              <div
                key={box.id}
                className="absolute"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  setActiveTextBoxId(box.id)
                }}
              >
                <textarea
                  data-text-box-id={box.id}
                  value={box.text}
                  onChange={(event) => updateTextBox(box.id, { text: event.target.value })}
                  placeholder="입력"
                  className={`min-h-12 w-full resize rounded-lg border bg-white/55 px-2.5 py-2 text-[16px] leading-relaxed text-rose-ink outline-none backdrop-blur-[1px] placeholder:text-rose-key/60 focus:bg-white/70 ${
                    active ? 'border-rose-accent shadow-sm' : 'border-rose-accent/30'
                  }`}
                />
                {active && (
                  <div className="mt-1.5 inline-flex items-center gap-0.5 rounded-full border border-rose-line bg-rose-card/95 px-1.5 py-1 shadow-md backdrop-blur">
                    <button
                      type="button"
                      onPointerDown={(event) => startMoveTextBox(event, box)}
                      className="cursor-grab rounded-full bg-rose-accent px-2.5 py-1 text-xs font-bold text-white active:cursor-grabbing"
                    >
                      이동
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-rose-line" />
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { y: Math.max(0, box.y - 0.015) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="위로"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { y: Math.min(0.94, box.y + 0.015) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="아래로"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { x: Math.max(0, box.x - 0.015) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="왼쪽으로"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { x: Math.min(0.88, box.x + 0.015) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="오른쪽으로"
                    >
                      →
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-rose-line" />
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { width: Math.max(0.18, box.width - 0.04) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="너비 줄이기"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { width: Math.min(0.82, box.width + 0.04) })}
                      className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-rose-key transition hover:bg-rose-chip"
                      aria-label="너비 늘리기"
                    >
                      +
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-rose-line" />
                    <button
                      type="button"
                      onClick={() => deleteTextBox(box.id)}
                      className="rounded-full px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-chip"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {textBoxes.length === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-ink/70 px-4 py-1.5 text-[13px] font-bold text-white shadow-sm backdrop-blur-[2px]">
              입력할 위치를 탭하세요
            </div>
          )}
        </>
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full rounded-[16px] ${mode === 'ink' ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={startStroke}
      />
      {mode === 'ink' && (
        <div className="safe-pad fixed bottom-3 left-1/2 z-30 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-full border border-rose-line bg-rose-card/95 px-3 py-1.5 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setTool('pen')}
            className={`rounded-full px-2.5 py-1 text-[13px] font-bold transition ${
              tool === 'pen' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key hover:text-rose-ink'
            }`}
          >
            ✏️ 펜
          </button>
          <button
            type="button"
            onClick={() => setTool('eraser')}
            className={`rounded-full px-2.5 py-1 text-[13px] font-bold transition ${
              tool === 'eraser' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key hover:text-rose-ink'
            }`}
          >
            🧽 지우개
          </button>
          <span className="mx-0.5 h-4 w-px bg-rose-line" />
          {PEN_COLORS.map((penColor) => (
            <button
              key={penColor}
              type="button"
              onClick={() => {
                setColor(penColor)
                setTool('pen')
              }}
              className={`h-6 w-6 rounded-full border-2 transition ${
                color === penColor && tool === 'pen'
                  ? 'scale-110 border-rose-accent'
                  : 'border-white hover:scale-105'
              }`}
              style={{ backgroundColor: penColor }}
              aria-label={`색상 ${penColor}`}
            />
          ))}
          <input
            type="range"
            min={1}
            max={14}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className="w-20 accent-rose-accent"
            aria-label="펜 굵기"
          />
          <span className="mx-0.5 h-4 w-px bg-rose-line" />
          <button
            type="button"
            onClick={undo}
            className="rounded-full px-2.5 py-1 text-[13px] font-bold text-rose-key transition hover:text-rose-ink"
          >
            ↩️ 취소
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-full px-2.5 py-1 text-[13px] font-bold text-rose-key transition hover:text-rose-ink"
          >
            지우기
          </button>
        </div>
      )}
    </div>
  )
}

function PdfThumbnail({
  pdfDocument,
  pageNumber,
  active,
}: {
  pdfDocument: PdfDocument | null
  pageNumber: number
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | null>(null)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    const doc = pdfDocument
    if (!doc || !canvas) return

    async function renderThumbnail(currentDoc: PdfDocument, currentCanvas: HTMLCanvasElement) {
      renderTaskRef.current?.cancel()
      const page = await currentDoc.getPage(pageNumber)
      if (cancelled) return
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = 520 / baseViewport.width
      const viewport = page.getViewport({ scale })
      const context = currentCanvas.getContext('2d')
      if (!context) return

      currentCanvas.width = Math.floor(viewport.width)
      currentCanvas.height = Math.floor(viewport.height)
      currentCanvas.style.width = ''
      currentCanvas.style.height = ''
      context.fillStyle = '#fff'
      context.fillRect(0, 0, currentCanvas.width, currentCanvas.height)

      const task = page.render({ canvasContext: context, viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          console.error(error)
        }
      }
    }

    void renderThumbnail(doc, canvas)
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [pdfDocument, pageNumber])

  return (
    <div
      className={`relative mx-auto flex shrink-0 items-center justify-center overflow-hidden bg-white transition ${
        active
          ? 'h-[100px] w-[72px] rounded-lg shadow-md ring-2 ring-rose-accent'
          : 'h-[84px] w-[58px] cursor-pointer rounded-md border border-rose-line opacity-75 shadow-sm transition hover:opacity-100'
      }`}
    >
      <canvas ref={canvasRef} className="block h-full w-full bg-white object-contain" />
      <span
        className={`absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-black shadow-sm ${
          active ? 'bg-rose-accent text-white' : 'bg-white/90 text-rose-key'
        }`}
      >
        {pageNumber}
      </span>
    </div>
  )
}

function PdfPage({
  pdfDocument,
  pageNumber,
  field,
  textBoxes,
  mode,
  onChange,
  onTextBoxesChange,
}: {
  pdfDocument: PdfDocument | null
  pageNumber: number
  field: Field
  textBoxes: BinderTextBox[]
  mode: FieldMode
  onChange: (field: Field) => void
  onTextBoxesChange: (boxes: BinderTextBox[]) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | null>(null)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    const doc = pdfDocument
    if (!doc || !canvas) return

    async function renderPage(currentDoc: PdfDocument, currentCanvas: HTMLCanvasElement) {
      renderTaskRef.current?.cancel()
      const page = await currentDoc.getPage(pageNumber)
      if (cancelled) return
      const baseViewport = page.getViewport({ scale: 1 })
      const parentWidth = currentCanvas.parentElement?.clientWidth ?? 720
      const scale = Math.min(2.2, Math.max(0.8, parentWidth / baseViewport.width))
      const viewport = page.getViewport({ scale })
      const context = currentCanvas.getContext('2d')
      if (!context) return
      currentCanvas.width = Math.floor(viewport.width)
      currentCanvas.height = Math.floor(viewport.height)
      currentCanvas.style.width = '100%'
      currentCanvas.style.height = 'auto'
      context.fillStyle = '#fff'
      context.fillRect(0, 0, currentCanvas.width, currentCanvas.height)
      const task = page.render({ canvasContext: context, viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          console.error(error)
        }
      }
    }

    void renderPage(doc, canvas)
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [pdfDocument, pageNumber])

  return (
    <div className="relative w-full rounded-[16px] shadow-[0_8px_28px_rgba(44,39,34,0.14)]">
      <canvas ref={canvasRef} className="block w-full rounded-[16px] bg-white" />
      <PageOverlay
        field={field}
        textBoxes={textBoxes}
        mode={mode}
        onChange={onChange}
        onTextBoxesChange={onTextBoxesChange}
      />
    </div>
  )
}

export default function BinderPage() {
  const { user, signOut } = useAuth()
  // 토큰 갱신 등으로 user 객체 참조가 바뀌어도 재조회하지 않도록 id 문자열만 의존
  const userId = user?.id
  const [selectedId, setSelectedId] = useState(binderBooks[0]?.id ?? '')
  const [work, setWork] = useState<BinderWork | null>(null)
  const [document, setDocument] = useState<PdfDocument | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(binderBooks[0]?.pages ?? 1)
  const [loadingPdf, setLoadingPdf] = useState(true)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [previewDragging, setPreviewDragging] = useState(false)
  const previewDragRef = useRef<{ startX: number; startPage: number; lastPage: number } | null>(null)
  const previewMovedRef = useRef(false)
  const shelfDragRef = useRef<{ pointerId: number; startX: number; startLeft: number; moved: boolean } | null>(null)
  const shelfMovedRef = useRef(false)
  // 이어보기: 부팅 복원이 끝나기 전에는 마지막 위치를 저장하지 않는다
  const bootRef = useRef(true)
  // 권을 바꾼 뒤 사용자가 직접 페이지를 넘겼으면 복원으로 되돌리지 않는다
  const navigatedSinceSelectRef = useRef(false)
  const workRef = useRef<BinderWork | null>(null)

  useEffect(() => {
    workRef.current = work
  }, [work])

  const selected = binderBooks.find((book) => book.id === selectedId) ?? binderBooks[0]
  const pageKey = String(pageNumber)
  const pageInput = work?.pageInputs[pageKey] ?? emptyField()
  const pageTextBoxes = work?.pageTextBoxes[pageKey] ?? []
  const checkpoints = defaultCheckpoints(selected.id).filter((checkpoint) => checkpoint.page <= pageCount)
  const previewPages = nearbyPages(pageNumber, pageCount)
  const bookmarks = [...(work?.bookmarks ?? [])].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
  const currentPageBookmarked = bookmarks.some((bookmark) => bookmark.page === pageNumber)
  const completedPages = work
    ? new Set([
        ...Object.entries(work.pageInputs)
          .filter(([, field]) => field.text.trim() || field.strokes.length)
          .map(([page]) => page),
        ...Object.entries(work.pageTextBoxes ?? {})
          .filter(([, boxes]) => boxes.some((box) => box.text.trim()))
          .map(([page]) => page),
      ]).size
    : 0

  // 부팅 시 계정의 마지막 사용 권으로 이동
  useEffect(() => {
    if (!userId) return
    let alive = true
    getLastBinderBookId(userId)
      .then((bookId) => {
        if (!alive || !bookId) return
        if (binderBooks.some((book) => book.id === bookId)) setSelectedId(bookId)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let alive = true
    navigatedSinceSelectRef.current = false
    const resetTimer = window.setTimeout(() => {
      if (alive) {
        setWork(null)
        setPageNumber(1)
      }
    }, 0)
    getBinderWork(selected.id, userId).then((next) => {
      if (!alive) return
      window.clearTimeout(resetTimer)
      // 이 권에서 마지막으로 보던 쪽으로 이어보기 (이미 직접 넘겼으면 유지)
      const target = next.lastPageNumber && next.lastPageNumber > 0 ? next.lastPageNumber : 1
      const restored = Math.max(1, Math.min(selected.pages, target))
      if (!navigatedSinceSelectRef.current) setPageNumber(restored)

      if (bootRef.current) {
        // 부팅 복원: 열람만으로 최근 사용 순서를 바꾸지 않는다
        bootRef.current = false
        workRef.current = next
        setWork(next)
        return
      }
      // 사용자가 직접 고른 권: 페이지를 안 넘겨도 "마지막 사용 권"으로 기록
      const touched = { ...next, lastPageNumber: restored }
      workRef.current = touched
      setWork(touched)
      void putBinderWork(touched, userId).catch(() => {})
    })
    return () => {
      alive = false
      window.clearTimeout(resetTimer)
    }
  }, [selected.id, selected.pages, userId])

  // 마지막 위치(권·쪽) 저장 — 계정별 이어보기용
  useEffect(() => {
    if (!userId || bootRef.current) return
    const timer = window.setTimeout(() => {
      const current = workRef.current
      if (!current || current.bookId !== selected.id) return
      if (current.lastPageNumber === pageNumber) return
      const next = { ...current, lastPageNumber: pageNumber }
      workRef.current = next
      setWork(next)
      void putBinderWork(next, userId).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [pageNumber, selected.id, userId])

  useEffect(() => {
    let alive = true
    const resetTimer = window.setTimeout(() => {
      if (!alive) return
      setDocument(null)
      setPageCount(selected.pages)
      setLoadingPdf(true)
    }, 0)
    const task = pdfjsLib.getDocument({ url: binderUrl(selected) })
    task.promise
      .then((next) => {
        if (!alive) return
        setDocument(next)
        setPageCount(next.numPages)
      })
      .catch((error) => {
        if (alive) console.error(error)
      })
      .finally(() => {
        if (alive) setLoadingPdf(false)
      })
    return () => {
      alive = false
      window.clearTimeout(resetTimer)
      task.destroy()
    }
  }, [selected])

  const updateWork = (next: BinderWork) => {
    setWork(next)
    void putBinderWork(next, user?.id)
  }

  const updatePageInput = (field: Field) => {
    if (!work) return
    updateWork({
      ...work,
      pageInputs: {
        ...work.pageInputs,
        [pageKey]: field,
      },
      updatedAt: Date.now(),
    })
  }

  const updatePageTextBoxes = (boxes: BinderTextBox[]) => {
    if (!work) return
    updateWork({
      ...work,
      pageTextBoxes: {
        ...(work.pageTextBoxes ?? {}),
        [pageKey]: boxes,
      },
      updatedAt: Date.now(),
    })
  }

  const setPageInputMode = (nextMode: FieldMode) => {
    updatePageInput({ ...pageInput, mode: nextMode })
  }

  const addBookmark = () => {
    if (!work) return
    const fallback = `${pageNumber}쪽`
    const label = window.prompt('책갈피 이름', fallback)?.trim()
    if (!label) return
    const bookmark: BinderBookmark = {
      id: crypto.randomUUID(),
      page: pageNumber,
      label,
      createdAt: Date.now(),
    }
    updateWork({
      ...work,
      bookmarks: [...(work.bookmarks ?? []), bookmark],
      updatedAt: Date.now(),
    })
  }

  const removeBookmark = (id: string) => {
    if (!work) return
    updateWork({
      ...work,
      bookmarks: (work.bookmarks ?? []).filter((bookmark) => bookmark.id !== id),
      updatedAt: Date.now(),
    })
  }

  const goPrev = () => {
    navigatedSinceSelectRef.current = true
    setPageNumber((prev) => Math.max(1, prev - 1))
  }
  const goNext = () => {
    navigatedSinceSelectRef.current = true
    setPageNumber((prev) => Math.min(pageCount, prev + 1))
  }
  const goToPage = (next: number) => {
    navigatedSinceSelectRef.current = true
    setPageNumber(Math.max(1, Math.min(pageCount, next)))
  }

  const startPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (loadingPdf || !document) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    previewMovedRef.current = false
    previewDragRef.current = { startX: event.clientX, startPage: pageNumber, lastPage: pageNumber }
    setPreviewDragging(true)
  }

  const movePreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current
    if (!drag) return
    event.preventDefault()
    // 썸네일 한 칸 폭(약 60px)마다 1쪽 — 살짝 움직인 건 탭으로 취급되도록 trunc 사용
    const pageDelta = Math.trunc((drag.startX - event.clientX) / 60)
    const nextPage = Math.max(1, Math.min(pageCount, drag.startPage + pageDelta))
    if (nextPage === drag.lastPage) return
    previewMovedRef.current = true
    navigatedSinceSelectRef.current = true
    drag.lastPage = nextPage
    setPageNumber(nextPage)
  }

  const endPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!previewDragRef.current) return
    previewDragRef.current = null
    setPreviewDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 드래그가 아니라 탭이면 그 자리의 썸네일로 이동.
    // 캡처가 클릭 이벤트를 컨테이너로 돌려버려 썸네일 onClick은 오지 않으므로
    // 손을 뗀 좌표에서 직접 찾는다. (state `document`가 전역을 가리므로 window.document)
    if (event.type !== 'pointercancel' && !previewMovedRef.current) {
      const hit = window.document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-preview-page]')
      const page = hit ? Number(hit.getAttribute('data-preview-page')) : NaN
      if (!Number.isNaN(page)) goToPage(page)
    }
  }

  // 권 선택 책장: 스크롤바 없이도 마우스·펜·터치 드래그로 넘길 수 있게 한다.
  // 캡처는 실제로 움직이기 시작한 뒤에만 잡아, 가만히 탭한 책등의 클릭은 살린다.
  const startShelfDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    shelfMovedRef.current = false
    shelfDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: event.currentTarget.scrollLeft,
      moved: false,
    }
  }

  const moveShelfDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = shelfDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = drag.startX - event.clientX
    if (!drag.moved) {
      if (Math.abs(dx) < 8) return
      drag.moved = true
      shelfMovedRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.currentTarget.scrollLeft = drag.startLeft + dx
  }

  const endShelfDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = shelfDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    shelfDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleTouchEnd = (x: number) => {
    if (touchStart === null) return
    const delta = x - touchStart
    setTouchStart(null)
    if (Math.abs(delta) < 48) return
    if (delta < 0) goNext()
    else goPrev()
  }

  return (
    <div className="min-h-full bg-rose-bg text-rose-ink">
      <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex w-24 shrink-0 items-center">
            {__APP_TARGET__ === 'all' ? (
              <button
                type="button"
                onClick={() => window.history.back()}
                className="text-sm font-bold text-rose-key hover:text-rose-accent"
              >
                ← 이전
              </button>
            ) : (
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">EDA</span>
                <span className="font-mono text-[9px] text-rose-key/45">v{__BUILD__}</span>
              </span>
            )}
          </div>
          <h1 className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">
            에다 SPL 바인더
          </h1>
          <div className="flex w-24 shrink-0 justify-end">
            {__APP_TARGET__ === 'all' && (
              <Link
                to="/"
                className="whitespace-nowrap rounded-full border border-rose-line bg-rose-card px-3.5 py-1.5 text-sm font-bold text-rose-key shadow-sm transition hover:text-rose-accent"
              >
                노트
              </Link>
            )}
            {__APP_TARGET__ !== 'all' && (
              <button
                type="button"
                onClick={signOut}
                className="whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent"
              >
                로그아웃
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start">
        <aside className="order-2 space-y-4 xl:order-1 xl:sticky xl:top-[66px] xl:self-start">
          <section className="relative overflow-hidden rounded-[20px] border border-rose-line bg-rose-card p-5 pl-7 shadow-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-rose-accent" />
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black tracking-[0.3em] text-rose-key/80">EDA · SPL</p>
              <span className="rounded-full bg-rose-chip px-2.5 py-0.5 text-[11px] font-black text-rose-accent">
                {selected.issue}호
              </span>
            </div>
            <p className="mt-3 break-keep font-serif text-[23px] font-extrabold leading-snug">{selected.title}</p>
            <div className="mt-5">
              <div className="flex items-baseline justify-between text-xs font-bold text-rose-key">
                <span>입력한 쪽</span>
                <span className="tabular-nums">
                  <span className="text-rose-accent">{completedPages}</span> / {pageCount}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-chip">
                <div
                  className="h-full rounded-full bg-rose-accent transition-[width] duration-300"
                  style={{ width: `${pageCount ? Math.min(100, (completedPages / pageCount) * 100) : 0}%` }}
                />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[18px] border border-rose-line bg-rose-card shadow-sm">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="font-serif text-base font-extrabold">권 선택</h2>
              <span className="text-xs font-bold text-rose-key/80">{binderBooks.length}권</span>
            </div>
            <div className="px-3 pb-3 pt-2">
              <div
                className="no-scrollbar flex cursor-grab items-end gap-1.5 overflow-x-auto px-1 pb-1 pt-2 active:cursor-grabbing"
                style={{ touchAction: 'pan-y' }}
                onPointerDown={startShelfDrag}
                onPointerMove={moveShelfDrag}
                onPointerUp={endShelfDrag}
                onPointerCancel={endShelfDrag}
              >
                {binderBooks.map((book) => {
                  const active = selected.id === book.id
                  return (
                    <button
                      type="button"
                      key={book.id}
                      onClick={() => {
                        if (shelfMovedRef.current) return
                        setSelectedId(book.id)
                      }}
                      className={`group relative flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-md rounded-b-sm border px-1.5 py-2.5 transition ${
                        active
                          ? '-translate-y-1.5 border-rose-accent bg-rose-accent text-white shadow-lg shadow-rose-accent/30'
                          : 'border-rose-line bg-rose-bg text-rose-key hover:-translate-y-1 hover:border-rose-accent/50 hover:text-rose-accent'
                      }`}
                      style={{ width: 42, height: 132 }}
                      aria-label={`${book.title} 선택`}
                    >
                      <span
                        className={`pointer-events-none absolute inset-y-0 left-[3px] w-px ${
                          active ? 'bg-white/30' : 'bg-white'
                        }`}
                      />
                      <span className={`text-[9px] font-black tracking-[0.14em] ${active ? 'text-white/70' : 'text-rose-key/60'}`}>
                        EDA
                      </span>
                      <span className="mx-auto flex flex-1 items-center justify-center">
                        <span className="[writing-mode:vertical-rl] font-serif text-[13px] font-extrabold tracking-[0.2em]">
                          SPL
                        </span>
                      </span>
                      <span className="text-center font-serif text-[15px] font-extrabold leading-tight">
                        {book.issue}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="h-1.5 rounded-full bg-rose-chip shadow-inner" />
            </div>
          </section>

          <section className="rounded-[18px] border border-rose-line bg-rose-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between px-1.5">
              <h2 className="font-serif text-base font-extrabold">체크포인트</h2>
              <button
                type="button"
                onClick={addBookmark}
                className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-accent hover:text-white"
              >
                + 책갈피
              </button>
            </div>
            <div className="space-y-0.5">
              {checkpoints.map((checkpoint) => {
                const active = pageNumber === checkpoint.page
                return (
                  <button
                    type="button"
                    key={checkpoint.id}
                    onClick={() => goToPage(checkpoint.page)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                      active
                        ? 'bg-rose-chip font-extrabold text-rose-accent'
                        : 'font-bold text-rose-key hover:bg-rose-chip/50 hover:text-rose-ink'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-rose-accent' : 'bg-rose-line'}`}
                      />
                      <span className="truncate">{checkpoint.label}</span>
                    </span>
                    <span className={`shrink-0 text-xs tabular-nums ${active ? 'text-rose-accent' : 'text-rose-key/60'}`}>
                      {checkpoint.page}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 border-t border-rose-line pt-2.5">
              <div className="mb-1.5 flex items-center justify-between px-1.5">
                <h3 className="text-sm font-extrabold text-rose-ink">내 책갈피</h3>
                {currentPageBookmarked && <span className="text-xs font-bold text-rose-accent">현재 쪽</span>}
              </div>
              {bookmarks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-rose-line px-3 py-2.5 text-[13px] leading-5 text-rose-key/80">
                  + 책갈피를 누르면 지금 보는 쪽이 저장돼요.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {bookmarks.map((bookmark) => {
                    const active = pageNumber === bookmark.page
                    return (
                      <div
                        key={bookmark.id}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${
                          active ? 'bg-rose-chip' : 'hover:bg-rose-chip/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => goToPage(bookmark.page)}
                          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                        >
                          <span
                            className={`block truncate text-sm font-bold ${
                              active ? 'text-rose-accent' : 'text-rose-key'
                            }`}
                          >
                            {bookmark.label}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-rose-key/60">{bookmark.page}쪽</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBookmark(bookmark.id)}
                          className="rounded-full px-1.5 py-0.5 text-xs font-bold text-rose-key/50 transition hover:bg-rose-bg hover:text-rose-accent"
                          aria-label={`${bookmark.label} 책갈피 삭제`}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

        </aside>

        <section className="order-1 min-w-0 space-y-3 xl:order-2">
          <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-rose-line bg-rose-card px-3.5 py-2.5 shadow-sm">
            <h2 className="min-w-0 flex-1 truncate font-serif text-lg font-extrabold">{selected.title}</h2>
            <select
              value={checkpoints.find((checkpoint) => checkpoint.page === pageNumber)?.id ?? ''}
              onChange={(event) => {
                const checkpoint = checkpoints.find((item) => item.id === event.target.value)
                if (checkpoint) goToPage(checkpoint.page)
              }}
              className="max-w-36 shrink-0 rounded-full border border-rose-line bg-rose-bg px-3 py-1.5 text-[13px] font-bold text-rose-key outline-none focus:border-rose-accent xl:hidden"
              aria-label="체크포인트로 이동"
            >
              <option value="" disabled>
                바로가기
              </option>
              {checkpoints.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpoint.label} · {checkpoint.page}쪽
                </option>
              ))}
            </select>
            <ModeToggle mode={pageInput.mode} onChange={setPageInputMode} />
          </div>

          {/* 근처 쪽 미리보기 필름스트립 — 드래그로 훑고, 탭하면 그 쪽으로 이동 */}
          <div
            className={`flex h-[120px] select-none items-center justify-center gap-1.5 overflow-hidden rounded-[18px] border border-rose-line bg-rose-card px-2 py-2 shadow-sm ${
              previewDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ touchAction: 'none' }}
            onPointerDown={startPreviewDrag}
            onPointerMove={movePreviewDrag}
            onPointerUp={endPreviewDrag}
            onPointerCancel={endPreviewDrag}
            aria-label="내용 미리보기 — 드래그로 넘기고 탭하면 이동"
          >
            {loadingPdf || !document ? (
              <span className="text-sm font-bold text-rose-key">미리보기를 불러오는 중...</span>
            ) : (
              previewPages.map((previewPage) => {
                const active = previewPage === pageNumber
                return (
                  <div key={previewPage} data-preview-page={previewPage}>
                    <PdfThumbnail pdfDocument={document} pageNumber={previewPage} active={active} />
                  </div>
                )
              })
            )}
          </div>

          <article
            className="relative rounded-[22px] border border-rose-line bg-rose-chip/50 p-2.5 sm:p-3"
            onTouchStart={(event) => setTouchStart(event.changedTouches[0]?.clientX ?? null)}
            onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
          >
            {loadingPdf ? (
              <div className="grid min-h-[56vh] place-items-center rounded-[18px] bg-rose-card text-rose-key">
                바인더를 펼치는 중...
              </div>
            ) : document ? (
              <PdfPage
                pdfDocument={document}
                pageNumber={pageNumber}
                field={pageInput}
                textBoxes={pageTextBoxes}
                mode={pageInput.mode}
                onChange={updatePageInput}
                onTextBoxesChange={updatePageTextBoxes}
              />
            ) : (
              <div className="grid min-h-[56vh] place-items-center rounded-[18px] bg-rose-card text-rose-key">
                PDF를 불러오지 못했습니다.
              </div>
            )}

            {/* 페이지 위에 떠 있는 좌우 넘김 (태블릿 이상) */}
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNumber === 1}
              className="absolute left-0 top-1/2 z-10 hidden h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-rose-line bg-rose-card text-base font-bold text-rose-key shadow-md transition hover:text-rose-accent disabled:opacity-0 md:grid"
              aria-label="이전 쪽"
            >
              ←
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={pageNumber >= pageCount}
              className="absolute right-0 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-rose-line bg-rose-card text-base font-bold text-rose-key shadow-md transition hover:text-rose-accent disabled:opacity-0 md:grid"
              aria-label="다음 쪽"
            >
              →
            </button>
          </article>

          <div className="flex items-center gap-2.5 rounded-full border border-rose-line bg-rose-card py-1.5 pl-2 pr-4 shadow-sm">
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNumber === 1}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-rose-key transition hover:bg-rose-chip disabled:opacity-30 md:hidden"
              aria-label="이전 쪽"
            >
              ←
            </button>
            <input
              type="range"
              min={1}
              max={pageCount}
              step={1}
              value={pageNumber}
              onChange={(event) => goToPage(Number(event.target.value))}
              className="pager-range min-w-0 flex-1"
              aria-label="페이지 이동"
            />
            <button
              type="button"
              onClick={goNext}
              disabled={pageNumber >= pageCount}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-rose-key transition hover:bg-rose-chip disabled:opacity-30 md:hidden"
              aria-label="다음 쪽"
            >
              →
            </button>
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-rose-key">
              <span className="text-rose-accent">{pageNumber}</span> / {pageCount}
            </span>
          </div>
        </section>

      </main>
    </div>
  )
}
