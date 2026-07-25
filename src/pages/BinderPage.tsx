import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { canvasToJpegFile, shareOrDownloadFiles } from '../shareImage'
import { emptyField, type Field, type FieldMode, type Stroke } from '../types'
import { t } from '../i18n/strings'
import LangToggle from '../components/LangToggle'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// The binder PDF itself is source material and intentionally remains in Korean.

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
type InkTool = 'pen' | 'eraser'

const PEN_COLORS = ['#3a3626', '#7e7a28', '#348a44', '#2563eb', '#d97706', '#be185d']

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

// 텍스트 상자는 한 번 탭으로 만들면 오탭이 잦아 두 번 탭으로만 만든다
const DOUBLE_TAP_MS = 500
const DOUBLE_TAP_SLOP_PX = 40
// 상자 크기는 쪽 대비 비율로 저장하지만, 최소 크기는 px로 잡아야
// 좁은 폰에서도 한 줄이 들어가는 크기가 보장된다
const NEW_TEXT_BOX_WIDTH_RATIO = 0.34
const NEW_TEXT_BOX_HEIGHT_PX = 56
const MIN_TEXT_BOX_WIDTH_PX = 90
const MIN_TEXT_BOX_HEIGHT_PX = 44

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

interface BinderCheckpoint {
  id: string
  label: string
  page: number
}

function defaultCheckpoints(bookId: string): BinderCheckpoint[] {
  if (bookId === 'spl-00-01') {
    return t('binderCheckpoints')
  }
  return t('binderCheckpointsShort')
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

/** 텍스트 상자를 공유 이미지에 그린다 — 화면과 같이 테두리 없이 글자만, 자동 줄바꿈 포함 */
function paintShareTextBox(
  ctx: CanvasRenderingContext2D,
  box: BinderTextBox,
  canvasWidth: number,
  canvasHeight: number,
  exportScale: number,
) {
  const fontSize = 16 * exportScale
  const lineHeight = fontSize * 1.625
  const paddingX = 10 * exportScale
  const paddingY = 8 * exportScale
  const x = box.x * canvasWidth
  const y = box.y * canvasHeight
  const maxWidth = box.width * canvasWidth - paddingX * 2

  ctx.font = `${fontSize}px 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif`
  ctx.textBaseline = 'top'

  const lines: string[] = []
  for (const raw of box.text.split('\n')) {
    let line = ''
    for (const char of raw) {
      if (ctx.measureText(line + char).width > maxWidth && line) {
        lines.push(line)
        line = char
      } else {
        line += char
      }
    }
    lines.push(line)
  }

  ctx.fillStyle = '#3a3626'
  lines.forEach((line, index) => {
    ctx.fillText(line, x + paddingX, y + paddingY + index * lineHeight)
  })
}

/** 한 쪽을 PDF + 필기 획 + 텍스트 상자까지 합성한 공유용 캔버스로 렌더 */
async function renderSharePage(
  doc: PdfDocument,
  pageNumber: number,
  work: BinderWork | null,
  displayWidth: number,
): Promise<HTMLCanvasElement> {
  const EXPORT_WIDTH = 1400
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: EXPORT_WIDTH / base.width })

  const canvas = window.document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas context unavailable')

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  const key = String(pageNumber)
  // 필기 좌표는 화면 표시 폭 기준 px — 내보내기 폭에 맞춰 배율 적용
  const exportScale = EXPORT_WIDTH / Math.max(1, displayWidth)
  const strokes = work?.pageInputs[key]?.strokes ?? []
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.size * exportScale
    const [firstX, firstY] = stroke.points[0]
    if (stroke.points.length === 1) {
      ctx.beginPath()
      ctx.arc(firstX * exportScale, firstY * exportScale, (stroke.size * exportScale) / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(firstX * exportScale, firstY * exportScale)
    for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x * exportScale, y * exportScale)
    ctx.stroke()
  }

  const boxes = (work?.pageTextBoxes?.[key] ?? []).filter((box) => box.text.trim())
  for (const box of boxes) paintShareTextBox(ctx, box, canvas.width, canvas.height, exportScale)

  return canvas
}

function PageOverlay({
  field,
  textBoxes,
  mode,
  tool,
  color,
  size,
  onChange,
  onTextBoxesChange,
}: {
  field: Field
  textBoxes: BinderTextBox[]
  mode: FieldMode
  tool: InkTool
  color: string
  size: number
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
  // 터치 엔진은 최초 1회만 등록되므로 최신 값은 ref로 읽는다
  const inkPropsRef = useRef({ tool, color, size, mode, onChange })

  useEffect(() => {
    inkPropsRef.current = { tool, color, size, mode, onChange }
  }, [tool, color, size, mode, onChange])
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(null)
  // 이동·크기 조절 중에는 매 프레임 저장하지 않도록 손을 뗄 때까지 임시 상태로만 그린다
  const [draftTextBox, setDraftTextBox] = useState<BinderTextBox | null>(null)
  const draftTextBoxRef = useRef<BinderTextBox | null>(null)
  // 드래그가 배경 위에서 끝나면 그 pointerup이 "배경 탭"으로 오인돼 선택이 풀린다
  const draggingTextBoxRef = useRef(false)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const editable = mode === 'text'
  const visibleActiveTextBoxId =
    editable && textBoxes.some((box) => box.id === activeTextBoxId) ? activeTextBoxId : null
  const visibleTextBoxes = draftTextBox
    ? textBoxes.map((box) => (box.id === draftTextBox.id ? draftTextBox : box))
    : textBoxes

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

  const updateTextBox = (id: string, patch: Partial<BinderTextBox>) => {
    onTextBoxesChange(textBoxesRef.current.map((box) => (box.id === id ? { ...box, ...patch } : box)))
  }

  const filledTextBoxes = () => textBoxesRef.current.filter((box) => box.text.trim())

  // 비어 있는 상자는 테두리가 사라지면 보이지 않으므로 선택이 풀릴 때 정리한다
  const dropEmptyTextBoxes = () => {
    const filled = filledTextBoxes()
    if (filled.length !== textBoxesRef.current.length) onTextBoxesChange(filled)
  }

  const addTextBoxAt = (clientX: number, clientY: number, rect: DOMRect) => {
    const height = Math.max(MIN_TEXT_BOX_HEIGHT_PX, NEW_TEXT_BOX_HEIGHT_PX) / rect.height
    const box: BinderTextBox = {
      id: crypto.randomUUID(),
      x: clamp((clientX - rect.left) / rect.width, 0, Math.max(0, 1 - NEW_TEXT_BOX_WIDTH_RATIO)),
      y: clamp((clientY - rect.top) / rect.height, 0, Math.max(0, 1 - height)),
      width: NEW_TEXT_BOX_WIDTH_RATIO,
      height,
      text: '',
    }
    // iOS는 사용자 제스처 밖(setTimeout 등)에서 부른 focus()로 키보드를 열지 않는다.
    // 새 상자를 동기 렌더한 뒤 같은 이벤트 안에서 focus()해야 키보드가 올라온다.
    flushSync(() => {
      onTextBoxesChange([...filledTextBoxes(), box])
      setActiveTextBoxId(box.id)
    })
    window.document.querySelector<HTMLTextAreaElement>(`[data-text-box-id="${box.id}"]`)?.focus()
  }

  const handleOverlayTap = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || draggingTextBoxRef.current) return
    if (event.target !== event.currentTarget) return

    const previous = lastTapRef.current
    const now = Date.now()
    const isDoubleTap =
      previous !== null &&
      now - previous.time < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < DOUBLE_TAP_SLOP_PX

    if (!isDoubleTap) {
      lastTapRef.current = { time: now, x: event.clientX, y: event.clientY }
      setActiveTextBoxId(null)
      dropEmptyTextBoxes()
      // 배경 mousedown의 기본 동작(포커스 이동)을 막아뒀으므로 직접 풀어준다
      if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur()
      return
    }

    lastTapRef.current = null
    addTextBoxAt(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  }

  // 이동·크기 조절 공통: 드래그하는 동안은 draft만 갱신하고 손을 뗄 때 한 번 저장한다
  const startTextBoxDrag = (
    event: React.PointerEvent<HTMLElement>,
    box: BinderTextBox,
    resolve: (box: BinderTextBox, dx: number, dy: number, rect: DOMRect) => BinderTextBox,
  ) => {
    const overlay = overlayRef.current
    if (!overlay) return
    event.preventDefault()
    event.stopPropagation()
    setActiveTextBoxId(box.id)
    draggingTextBoxRef.current = true

    const rect = overlay.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY

    const setDraft = (next: BinderTextBox | null) => {
      draftTextBoxRef.current = next
      setDraftTextBox(next)
    }

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.cancelable) moveEvent.preventDefault()
      setDraft(resolve(box, moveEvent.clientX - startX, moveEvent.clientY - startY, rect))
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const draft = draftTextBoxRef.current
      setDraft(null)
      if (draft) updateTextBox(draft.id, { x: draft.x, y: draft.y, width: draft.width, height: draft.height })
      window.setTimeout(() => {
        draggingTextBoxRef.current = false
      }, 0)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const startMoveTextBox = (event: React.PointerEvent<HTMLElement>, box: BinderTextBox) =>
    startTextBoxDrag(event, box, (origin, dx, dy, rect) => ({
      ...origin,
      x: clamp(origin.x + dx / rect.width, 0, Math.max(0, 1 - origin.width)),
      y: clamp(
        origin.y + dy / rect.height,
        0,
        Math.max(0, 1 - (origin.height ?? MIN_TEXT_BOX_HEIGHT_PX / rect.height)),
      ),
    }))

  const startResizeTextBox = (event: React.PointerEvent<HTMLElement>, box: BinderTextBox) =>
    startTextBoxDrag(event, box, (origin, dx, dy, rect) => {
      const maxWidth = 1 - origin.x
      const maxHeight = 1 - origin.y
      const originHeight = origin.height ?? NEW_TEXT_BOX_HEIGHT_PX / rect.height
      return {
        ...origin,
        width: clamp(
          origin.width + dx / rect.width,
          Math.min(MIN_TEXT_BOX_WIDTH_PX / rect.width, maxWidth),
          maxWidth,
        ),
        height: clamp(
          originHeight + dy / rect.height,
          Math.min(MIN_TEXT_BOX_HEIGHT_PX / rect.height, maxHeight),
          maxHeight,
        ),
      }
    })

  const deleteTextBox = (id: string) => {
    onTextBoxesChange(textBoxesRef.current.filter((box) => box.id !== id))
    setActiveTextBoxId(null)
  }

  // touch-action은 상속되지 않는다. article의 pan-y가 오버레이까지 오지 않으므로 직접 지정해
  // 더블탭 줌 제스처를 끈다 — iOS Safari는 user-scalable=no를 무시해서, 켜져 있으면 두 번째
  // 탭을 브라우저가 가져가고 pointer 이벤트가 오지 않는다.
  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ touchAction: 'manipulation' }}
      onPointerUp={handleOverlayTap}
      // 터치는 pointerup '뒤에' 호환 mousedown을 보내 방금 focus한 입력칸의 포커스를 뺏는다
      // (= iOS에서 키보드가 안 올라옴). 입력칸 자체를 누른 게 아니면 기본 동작을 막는다.
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault()
      }}
    >
      {/* 손글씨 모드에서도 타이핑한 내용은 그대로 보이되, 펜 입력을 가로채지 않는다.
          레이어 자체는 항상 투명해야 배경 두 번 탭이 아래 overlay까지 내려간다. */}
      <div className="pointer-events-none absolute inset-0">
        {visibleTextBoxes.map((box) => {
          const active = visibleActiveTextBoxId === box.id
          return (
            <div
              key={box.id}
              className={`absolute ${editable ? 'pointer-events-auto' : ''}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: box.height ? `${box.height * 100}%` : undefined,
              }}
            >
              <textarea
                data-text-box-id={box.id}
                value={box.text}
                readOnly={!editable}
                onChange={(event) => updateTextBox(box.id, { text: event.target.value })}
                onFocus={() => setActiveTextBoxId(box.id)}
                placeholder={editable ? t('binderInputPlaceholder') : ''}
                className={`h-full w-full resize-none rounded-lg border px-2.5 py-2 text-[16px] leading-relaxed text-rose-ink outline-none transition-colors placeholder:text-rose-key/60 ${
                  box.height ? '' : 'min-h-12'
                } ${
                  active
                    ? 'border-rose-accent bg-white/70 shadow-sm backdrop-blur-[1px]'
                    : 'border-transparent bg-transparent'
                }`}
              />
              {active && (
                <>
                  <div
                    className={`absolute left-0 inline-flex items-center gap-0.5 rounded-full border border-rose-line bg-rose-card/95 px-1 py-0.5 shadow-md backdrop-blur ${
                      box.y < 0.08 ? '-bottom-9' : '-top-9'
                    }`}
                  >
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={t('binderMove')}
                      onPointerDown={(event) => startMoveTextBox(event, box)}
                      style={{ touchAction: 'none' }}
                      className="grid h-7 w-8 cursor-grab place-items-center rounded-full bg-rose-accent-deep text-xs font-bold text-white active:cursor-grabbing"
                    >
                      ⠿
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteTextBox(box.id)}
                      className="rounded-full px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-chip"
                    >
                      {t('binderDelete')}
                    </button>
                  </div>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('binderResize')}
                    onPointerDown={(event) => startResizeTextBox(event, box)}
                    style={{ touchAction: 'none' }}
                    className="absolute -bottom-2.5 -right-2.5 grid h-7 w-7 cursor-nwse-resize place-items-center rounded-full border border-rose-line bg-rose-card text-[11px] font-bold text-rose-key shadow-md"
                  >
                    ◢
                  </span>
                </>
              )}
            </div>
          )
        })}
        {editable && textBoxes.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-ink/70 px-4 py-1.5 text-[13px] font-bold text-white shadow-sm backdrop-blur-[2px]">
            {t('binderTapToInput')}
          </div>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full rounded-2xl ${mode === 'ink' ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={startStroke}
      />
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
          ? 'h-[76px] w-[54px] rounded-lg shadow-md ring-2 ring-rose-accent sm:h-[100px] sm:w-[72px]'
          : 'h-16 w-11 cursor-pointer rounded-md border border-rose-line opacity-75 shadow-sm transition hover:opacity-100 sm:h-[84px] sm:w-[58px]'
      }`}
    >
      <canvas ref={canvasRef} className="block h-full w-full bg-white object-contain" />
      <span
        className={`absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-black shadow-sm ${
          active ? 'bg-rose-accent-deep text-white' : 'bg-white/90 text-rose-key'
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
  tool,
  color,
  size,
  onChange,
  onTextBoxesChange,
}: {
  pdfDocument: PdfDocument | null
  pageNumber: number
  field: Field
  textBoxes: BinderTextBox[]
  mode: FieldMode
  tool: InkTool
  color: string
  size: number
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
    <div className="relative w-full rounded-2xl shadow-lift">
      <canvas ref={canvasRef} className="block w-full rounded-2xl bg-white" />
      <PageOverlay
        field={field}
        textBoxes={textBoxes}
        mode={mode}
        tool={tool}
        color={color}
        size={size}
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
  const [inkTool, setInkTool] = useState<InkTool>('pen')
  const [inkColor, setInkColor] = useState(PEN_COLORS[0])
  const [inkSize, setInkSize] = useState(4)
  // 입력 방식은 페이지가 아니라 세션의 도구 상태 — 쪽을 넘겨도 유지된다
  const [inputMode, setInputMode] = useState<FieldMode>('text')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareSelected, setShareSelected] = useState<number[]>([])
  const [shareExtraPages, setShareExtraPages] = useState<number[]>([])
  const [shareExtraInput, setShareExtraInput] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(binderBooks[0]?.pages ?? 1)
  const [loadingPdf, setLoadingPdf] = useState(true)
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
  // 체크포인트는 "구간"의 시작점 — 다음 체크포인트 직전까지가 그 구간이다
  const checkpointSections = defaultCheckpoints(selected.id)
    .filter((checkpoint) => checkpoint.page <= pageCount)
    .map((checkpoint, index, list) => ({
      ...checkpoint,
      endPage: index + 1 < list.length ? list[index + 1].page - 1 : pageCount,
    }))
  const activeCheckpointId =
    [...checkpointSections].reverse().find((section) => pageNumber >= section.page)?.id ?? ''
  const previewPages = nearbyPages(pageNumber, pageCount)
  const bookmarks = [...(work?.bookmarks ?? [])].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
  const currentPageBookmarked = bookmarks.some((bookmark) => bookmark.page === pageNumber)
  const inputPageSet = work
    ? new Set([
        ...Object.entries(work.pageInputs)
          .filter(([, field]) => field.text.trim() || field.strokes.length)
          .map(([page]) => Number(page)),
        ...Object.entries(work.pageTextBoxes ?? {})
          .filter(([, boxes]) => boxes.some((box) => box.text.trim()))
          .map(([page]) => Number(page)),
      ])
    : new Set<number>()
  const bookmarkPageSet = new Set(bookmarks.map((bookmark) => bookmark.page))
  // 공유 후보: 필기한 쪽 + 책갈피 쪽 + 현재 쪽 + 직접 추가한 쪽
  const shareCandidates = [
    ...new Set([pageNumber, ...inputPageSet, ...bookmarkPageSet, ...shareExtraPages]),
  ]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b)

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

  // 마지막 위치(권·쪽 + 체크포인트 구간별 쪽) 저장 — 계정별 이어보기용
  useEffect(() => {
    if (!userId || bootRef.current) return
    const timer = window.setTimeout(() => {
      const current = workRef.current
      if (!current || current.bookId !== selected.id) return
      const savedCheckpoints = current.checkpointPages ?? {}
      const checkpointChanged =
        activeCheckpointId !== '' && savedCheckpoints[activeCheckpointId] !== pageNumber
      if (current.lastPageNumber === pageNumber && !checkpointChanged) return
      const next: BinderWork = {
        ...current,
        lastPageNumber: pageNumber,
        checkpointPages: checkpointChanged
          ? { ...savedCheckpoints, [activeCheckpointId]: pageNumber }
          : savedCheckpoints,
      }
      workRef.current = next
      setWork(next)
      void putBinderWork(next, userId).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [activeCheckpointId, pageNumber, selected.id, userId])

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

  const addBookmark = () => {
    if (!work) return
    const fallback = t('binderPage')(pageNumber)
    const label = window.prompt(t('binderBookmarkName'), fallback)?.trim()
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
  // 그 구간에서 마지막으로 보던 쪽으로 이어보기 — 기록이 없거나 구간을 벗어났으면 첫 쪽
  const goToCheckpoint = (checkpointId: string) => {
    const section = checkpointSections.find((item) => item.id === checkpointId)
    if (!section) return
    const saved = work?.checkpointPages?.[checkpointId]
    const resumable = saved !== undefined && saved >= section.page && saved <= section.endPage
    goToPage(resumable ? saved : section.page)
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

  // 권 선택 책장: 터치·펜은 네이티브 관성 스크롤에 맡기고(부드러움),
  // 스크롤바가 없는 마우스만 수동 드래그 스크롤을 붙인다.
  // 캡처는 실제로 움직이기 시작한 뒤에만 잡아, 가만히 탭한 책등의 클릭은 살린다.
  const startShelfDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
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

  const openShare = () => {
    setShareSelected([pageNumber])
    setShareExtraInput('')
    setShareOpen(true)
  }

  const toggleSharePage = (page: number) => {
    setShareSelected((prev) => (prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]))
  }

  const addShareExtraPage = () => {
    const page = Number(shareExtraInput)
    if (!Number.isInteger(page) || page < 1 || page > pageCount) return
    setShareExtraPages((prev) => (prev.includes(page) ? prev : [...prev, page]))
    setShareSelected((prev) => (prev.includes(page) ? prev : [...prev, page]))
    setShareExtraInput('')
  }

  const sharePages = async () => {
    if (!document || shareBusy || shareSelected.length === 0) return
    setShareBusy(true)
    try {
      await window.document.fonts?.ready
      const displayWidth =
        window.document.querySelector('article canvas')?.getBoundingClientRect().width ?? 720
      const pages = [...shareSelected].sort((a, b) => a - b)
      const files: File[] = []
      for (const page of pages) {
        const canvas = await renderSharePage(document, page, work, displayWidth)
        files.push(
          await canvasToJpegFile(canvas, `eda-spl-${selected.issue}-p${String(page).padStart(3, '0')}.jpg`),
        )
      }
      const result = await shareOrDownloadFiles(
        files,
        t('binderShareTitle')(selected.issue),
        t('binderShareText')(
          t('binderVolumeTitle')(selected.issue),
          pages.map((page) => t('binderPage')(page)).join(', '),
        ),
      )
      if (result !== 'cancelled') setShareOpen(false)
    } catch (error) {
      console.error(error)
      alert(t('binderImageFailed'))
    } finally {
      setShareBusy(false)
    }
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
                {t('binderBack')}
              </button>
            ) : (
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">EDA</span>
                <span className="font-mono text-[9px] text-rose-key/45">v{__BUILD__}</span>
              </span>
            )}
          </div>
          <h1 className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">
             {t('binderAppTitle')}
          </h1>
          <div className="flex shrink-0 items-center justify-end gap-1">
            <LangToggle />
            {__APP_TARGET__ === 'all' && (
              <Link
                to="/"
                className="whitespace-nowrap rounded-full border border-rose-line bg-rose-card px-3.5 py-1.5 text-sm font-bold text-rose-key shadow-sm transition hover:text-rose-accent"
              >
                {t('binderNote')}
              </Link>
            )}
            {__APP_TARGET__ !== 'all' && (
              <button
                type="button"
                onClick={signOut}
                className="whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent"
              >
                {t('binderLogout')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start">
        {/* 폰·태블릿에서는 권 선택 → 체크포인트를 헤더 바로 아래로 올린다.
            권 표지 카드는 툴바에 같은 제목이 나오는 태블릿 구간에서만 숨긴다. */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-[66px] xl:self-start">
          <section className="relative order-3 overflow-hidden rounded-2xl border border-rose-line bg-rose-card p-5 pl-7 sm:hidden xl:order-1 xl:block">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-rose-accent" />
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black tracking-[0.3em] text-rose-key/80">EDA · SPL</p>
              <span className="rounded-full bg-rose-chip px-2.5 py-0.5 text-[11px] font-black text-rose-accent">
                {t('binderIssue')(selected.issue)}
              </span>
            </div>
            <p className="mt-3 break-keep font-serif text-[23px] font-extrabold leading-snug">{t('binderVolumeTitle')(selected.issue)}</p>
          </section>

          <section className="order-1 overflow-hidden rounded-2xl border border-rose-line bg-rose-card xl:order-2">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="flex items-center gap-2 font-serif text-base font-extrabold">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                {t('binderSelectVolume')}
              </h2>
              <span className="text-xs font-bold text-rose-key/80">{t('binderVolumeCount')(binderBooks.length)}</span>
            </div>
            <div className="px-3 pb-3 pt-2">
              <div
                className="no-scrollbar flex cursor-grab items-end gap-1.5 overflow-x-auto px-1 pb-1 pt-2 active:cursor-grabbing"
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
                          ? '-translate-y-1.5 border-rose-accent-deep bg-rose-accent-deep text-white shadow-lg shadow-rose-accent/25'
                          : 'border-rose-line bg-rose-bg text-rose-key hover:-translate-y-1 hover:border-rose-accent/50 hover:text-rose-accent'
                      }`}
                      style={{ width: 42, height: 132 }}
                      aria-label={t('binderSelectVolumeAria')(t('binderVolumeTitle')(book.issue))}
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
              <div className="h-1.5 rounded-full bg-rose-chip" />
            </div>
          </section>

          <section className="order-2 rounded-2xl border border-rose-line bg-rose-card p-3 xl:order-3">
            <div className="mb-2 flex items-center justify-between px-1.5">
              <h2 className="flex items-center gap-2 font-serif text-base font-extrabold">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                {t('binderCheckpoint')}
              </h2>
              <button
                type="button"
                onClick={addBookmark}
                className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-accent-deep hover:text-white"
              >
                {t('binderAddBookmark')}
              </button>
            </div>
            <div className="space-y-0.5">
              {checkpointSections.map((checkpoint) => {
                const active = activeCheckpointId === checkpoint.id
                return (
                  <button
                    type="button"
                    key={checkpoint.id}
                    onClick={() => goToCheckpoint(checkpoint.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                      active
                        ? 'bg-rose-chip font-extrabold text-rose-accent'
                        : 'font-bold text-rose-key hover:bg-rose-chip/50 hover:text-rose-ink'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-leaf' : 'bg-rose-line'}`}
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
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-rose-ink">
                  <span aria-hidden className="h-3 w-[3px] rounded-full bg-rose-accent" />
                  {t('binderMyBookmarks')}
                </h3>
                {currentPageBookmarked && <span className="text-xs font-bold text-rose-accent">{t('binderCurrentPage')}</span>}
              </div>
              {bookmarks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-rose-line px-3 py-2.5 text-[13px] leading-5 text-rose-key/80">
                  {t('binderBookmarkHint')}
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
                           <span className="shrink-0 text-xs tabular-nums text-rose-key/60">{t('binderPage')(bookmark.page)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBookmark(bookmark.id)}
                          className="rounded-full px-1.5 py-0.5 text-xs font-bold text-rose-key/50 transition hover:bg-rose-bg hover:text-rose-accent"
                           aria-label={t('binderBookmarkDeleteAria')(bookmark.label)}
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

        <section className="min-w-0 space-y-3">
          <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-line bg-rose-card/95 px-3.5 py-2.5 shadow-sm backdrop-blur">
            {/* 제목은 폰에서 숨김(헤더에 앱 이름이 있고, 툴바를 한 줄로 유지하기 위해) */}
            <h2 className="hidden min-w-0 flex-1 truncate font-serif text-lg font-extrabold sm:block">
              {t('binderVolumeTitle')(selected.issue)}
            </h2>
            <select
              value={activeCheckpointId}
              onChange={(event) => goToCheckpoint(event.target.value)}
              className="min-w-0 flex-1 rounded-full border border-rose-line bg-rose-bg px-3 py-1.5 text-[13px] font-bold text-rose-key outline-none focus:border-rose-accent sm:max-w-40 sm:flex-none"
              aria-label={t('binderCheckpointAria')}
            >
              <option value="" disabled>
                {t('binderShortcut')}
              </option>
              {checkpointSections.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpoint.label} · {t('binderPage')(checkpoint.page)}
                </option>
              ))}
            </select>
            <ModeToggle mode={inputMode} onChange={setInputMode} />
            <button
              type="button"
              onClick={openShare}
              className="flex shrink-0 items-center gap-1 rounded-full bg-rose-accent-deep px-3 py-1.5 text-[13px] font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95"
            >
              <span aria-hidden>📤</span> {t('binderShare')}
            </button>

            {/* 손글씨 도구 줄 — 필기 중 손에 가려지지 않게 상단에 고정 */}
            {inputMode === 'ink' && (
              <div className="flex w-full flex-wrap items-center gap-1 border-t border-rose-line pt-2 sm:gap-1.5">
                <button
                  type="button"
                  onClick={() => setInkTool('pen')}
                  className={`rounded-full px-2 py-1 text-[13px] font-bold transition sm:px-2.5 ${
                    inkTool === 'pen' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key hover:text-rose-ink'
                  }`}
                  aria-label={t('binderPen')}
                >
                  ✏️<span className="hidden sm:inline"> {t('binderPen')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInkTool('eraser')}
                  className={`rounded-full px-2 py-1 text-[13px] font-bold transition sm:px-2.5 ${
                    inkTool === 'eraser' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key hover:text-rose-ink'
                  }`}
                  aria-label={t('binderEraser')}
                >
                  🧽<span className="hidden sm:inline"> {t('binderEraser')}</span>
                </button>
                <span className="mx-0.5 hidden h-4 w-px bg-rose-line sm:block" />
                {PEN_COLORS.map((penColor) => (
                  <button
                    key={penColor}
                    type="button"
                    onClick={() => {
                      setInkColor(penColor)
                      setInkTool('pen')
                    }}
                    className={`h-5 w-5 rounded-full border-2 transition sm:h-6 sm:w-6 ${
                      inkColor === penColor && inkTool === 'pen'
                        ? 'scale-110 border-rose-accent'
                        : 'border-white hover:scale-105'
                    }`}
                    style={{ backgroundColor: penColor }}
                    aria-label={t('binderColor')(penColor)}
                  />
                ))}
                <input
                  type="range"
                  min={1}
                  max={14}
                  value={inkSize}
                  onChange={(event) => setInkSize(Number(event.target.value))}
                  className="w-14 accent-rose-accent-deep sm:w-20"
                  aria-label={t('binderPenSize')}
                />
                <span className="mx-0.5 hidden h-4 w-px bg-rose-line sm:block" />
                <button
                  type="button"
                  onClick={() => updatePageInput({ ...pageInput, strokes: pageInput.strokes.slice(0, -1) })}
                  disabled={pageInput.strokes.length === 0}
                  className="rounded-full px-2 py-1 text-[13px] font-bold text-rose-key transition hover:text-rose-ink disabled:opacity-40 sm:px-2.5"
                  aria-label={t('binderUndoAria')}
                >
                  ↩️<span className="hidden sm:inline"> {t('binderUndo')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => updatePageInput({ ...pageInput, strokes: [] })}
                  disabled={pageInput.strokes.length === 0}
                  className="rounded-full px-2 py-1 text-[13px] font-bold text-rose-key transition hover:text-rose-ink disabled:opacity-40 sm:px-2.5"
                  aria-label={t('binderClear')}
                >
                  🗑️<span className="hidden sm:inline"> {t('binderClear')}</span>
                </button>
              </div>
            )}
          </div>

          {/* 근처 쪽 미리보기 필름스트립 — 드래그로 훑고, 탭하면 그 쪽으로 이동 */}
          <div
            className={`flex h-[92px] select-none items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-rose-line bg-rose-card px-2 py-2 shadow-sm sm:h-[120px] ${
              previewDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ touchAction: 'none' }}
            onPointerDown={startPreviewDrag}
            onPointerMove={movePreviewDrag}
            onPointerUp={endPreviewDrag}
            onPointerCancel={endPreviewDrag}
            aria-label={t('binderPreviewAria')}
          >
            {loadingPdf || !document ? (
              <span className="text-sm font-bold text-rose-key">{t('binderPreviewLoading')}</span>
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
            className="relative rounded-3xl border border-rose-line bg-rose-chip/50 p-2.5 sm:p-3"
            style={{ touchAction: 'pan-y' }}
          >
            {loadingPdf ? (
              <div className="grid min-h-[56vh] place-items-center rounded-2xl bg-rose-card text-rose-key">
                {t('binderOpening')}
              </div>
            ) : document ? (
              <PdfPage
                pdfDocument={document}
                pageNumber={pageNumber}
                field={pageInput}
                textBoxes={pageTextBoxes}
                mode={inputMode}
                tool={inkTool}
                color={inkColor}
                size={inkSize}
                onChange={updatePageInput}
                onTextBoxesChange={updatePageTextBoxes}
              />
            ) : (
              <div className="grid min-h-[56vh] place-items-center rounded-2xl bg-rose-card text-rose-key">
                {t('binderPdfError')}
              </div>
            )}

            {/* 페이지 위에 떠 있는 좌우 넘김 — 아티클 안쪽에 고정해 좁은 폭에서도 뷰포트를 벗어나지 않는다.
                필기 중에는 숨긴다: 획이 버튼 위에서 시작하면 쪽이 넘어가 버린다 (하단 바로 이동 가능). */}
            {inputMode !== 'ink' && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={pageNumber === 1}
                  className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-lift transition active:scale-[0.98] disabled:opacity-40 sm:left-3 sm:h-12 sm:w-12"
                  aria-label={t('binderPrevPage')}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={pageNumber >= pageCount}
                  className="absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-lift transition active:scale-[0.98] disabled:opacity-40 sm:right-3 sm:h-12 sm:w-12"
                  aria-label={t('binderNextPage')}
                >
                  →
                </button>
              </>
            )}
          </article>

          <div className="flex items-center gap-2 rounded-full border border-rose-line bg-rose-card py-1 pl-1 pr-3 shadow-sm">
            <button
              type="button"
              onClick={goPrev}
              disabled={pageNumber === 1}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-40"
              aria-label={t('binderPrevPage')}
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
              aria-label={t('binderPageMove')}
            />
            <button
              type="button"
              onClick={goNext}
              disabled={pageNumber >= pageCount}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-40"
              aria-label={t('binderNextPage')}
            >
              →
            </button>
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-rose-key">
              <span className="text-rose-accent">{pageNumber}</span> / {pageCount}
            </span>
          </div>
        </section>

      </main>

      {/* 페이지 JPG 공유 모달 */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-rose-ink/45 p-4 backdrop-blur-[2px]"
          onClick={() => {
            if (!shareBusy) setShareOpen(false)
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-rose-line bg-rose-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-extrabold">{t('binderShareModalTitle')}</h3>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                disabled={shareBusy}
                className="grid h-8 w-8 place-items-center rounded-full text-rose-key transition hover:bg-rose-chip disabled:opacity-40"
                aria-label={t('binderClose')}
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-[13px] leading-5 text-rose-key">
              {t('binderShareHint')}
            </p>

            <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto rounded-xl bg-rose-chip/40 p-2 sm:grid-cols-4">
              {shareCandidates.map((page) => {
                const selectedPage = shareSelected.includes(page)
                return (
                  <button
                    type="button"
                    key={page}
                    onClick={() => toggleSharePage(page)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition ${
                      selectedPage
                        ? 'border-rose-accent bg-white shadow-sm'
                        : 'border-transparent bg-white/50 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <PdfThumbnail pdfDocument={document} pageNumber={page} active={selectedPage} />
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        selectedPage ? 'text-rose-accent' : 'text-rose-key'
                      }`}
                    >
                      {selectedPage ? '✓ ' : ''}
                      {t('binderPage')(page)} {inputPageSet.has(page) ? '✍️' : ''}
                      {bookmarkPageSet.has(page) ? '🔖' : ''}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={pageCount}
                value={shareExtraInput}
                onChange={(event) => setShareExtraInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addShareExtraPage()
                }}
                placeholder={t('binderPageNumber')}
                className="w-24 rounded-full border border-rose-line bg-white px-3 py-1.5 text-sm text-rose-ink outline-none focus:border-rose-accent"
                aria-label={t('binderAddPageAria')}
              />
              <button
                type="button"
                onClick={addShareExtraPage}
                className="rounded-full bg-rose-chip px-3 py-1.5 text-[13px] font-bold text-rose-accent transition hover:bg-rose-accent-deep hover:text-white"
              >
                {t('binderAddOtherPage')}
              </button>
              <span className="ml-auto text-[13px] font-bold tabular-nums text-rose-key">
                {t('binderSelectedPages')(shareSelected.length)}
              </span>
            </div>

            <button
              type="button"
              onClick={sharePages}
              disabled={shareBusy || shareSelected.length === 0}
              className="mt-3 w-full rounded-full bg-rose-accent-deep px-4 py-3 text-[15px] font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.99] disabled:opacity-50"
            >
              {shareBusy ? t('binderMakingImages') : t('binderJpgShare')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
