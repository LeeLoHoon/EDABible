import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useAuth } from '../authState'
import { ensureBinderFont } from '../binderFont'
import {
  binderPdfUrl,
  binderSetList,
  checkpointsForSet,
  findBinderSet,
  isKnownBinderSetId,
  type BinderCheckpoint,
} from '../binderLibrary'
import {
  convertLegacyPageText,
  migrateLocalBinderWorks,
  resolveLegacyResume,
} from '../binderMigration'
import BackButton from '../components/BackButton'
import BinderPageVideo from '../components/BinderPageVideo'
import BinderVideoSheet from '../components/BinderVideoSheet'
import BinderGuideSheet from '../components/BinderGuideSheet'
import ModeToggle from '../components/ModeToggle'
import {
  getBinderWork,
  getHiddenPages,
  getLastBinderBookId,
  isBinderAdmin,
  putBinderWork,
  putHiddenPages,
  BINDER_LOCAL_OWNER,
  type BinderBookmark,
  type BinderTextBox,
  type BinderWork,
} from '../db'
import { canvasToJpegFile, shareOrDownloadFiles } from '../shareImage'
import { emptyField, type Field, type FieldMode, type Stroke } from '../types'
import { t } from '../i18n/strings'
import { getLang } from '../i18n/lang'
import LangToggle from '../components/LangToggle'
import { registerSaveFlush } from '../saveFlush'
import { LatestValueDrain } from '../persistenceQueue'
import { lessonVideoBeforePage, videoStagesFor } from '../../scripts/binder_videos'
import { textPresetsFor, type BinderTextPreset } from '../../scripts/binder_text_presets'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// The binder PDF itself is source material and intentionally remains in Korean.

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
type InkTool = 'pen' | 'eraser'

interface PendingBinderSave {
  work: BinderWork
  ownerId?: string
}

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
// 마우스 더블클릭(약 500ms)보다 넉넉하게 잡는다. 손가락으로 "탭, 탭" 하는 간격은
// 그보다 느리고, 같은 자리(SLOP) 조건이 있어 길게 잡아도 오생성 위험이 낮다.
const DOUBLE_TAP_MS = 900
const DOUBLE_TAP_SLOP_PX = 40
// 한 번의 탭이 만드는 pointerup+click을 하나로 묶는 창
const SAME_TAP_MS = 80
// 상자 크기는 쪽 대비 비율로 저장하지만, 최소 크기는 px로 잡아야
// 좁은 폰에서도 한 줄이 들어가는 크기가 보장된다
const NEW_TEXT_BOX_WIDTH_RATIO = 0.34
const NEW_TEXT_BOX_HEIGHT_PX = 56
const MIN_TEXT_BOX_WIDTH_PX = 90
const MIN_TEXT_BOX_HEIGHT_PX = 44
const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_WINDOW_MS = 2_000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function nearbyPages(availablePages: number[], pageNumber: number, count = 5): number[] {
  if (availablePages.length === 0) return []
  const exactIndex = availablePages.indexOf(pageNumber)
  const currentIndex = exactIndex >= 0 ? exactIndex : 0
  const limit = Math.min(count, availablePages.length)
  const start = clamp(currentIndex - Math.floor(count / 2), 0, availablePages.length - limit)
  return availablePages.slice(start, start + limit)
}

function snapToVisiblePage(visiblePages: number[], target: number): number | null {
  if (visiblePages.length === 0) return null
  return visiblePages.reduce((best, page) => {
    const distance = Math.abs(page - target)
    const bestDistance = Math.abs(best - target)
    if (distance < bestDistance || (distance === bestDistance && page > best)) return page
    return best
  })
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
  // 화면의 .binder-text-box와 같은 고딕으로 그려야 공유 이미지가 쪽과 이어져 보인다
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
  setId: string,
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

  // 화면에서 인쇄된 괘선을 가리는 칸은 공유 이미지에서도 같은 자리를 가린다
  for (const preset of textPresetsFor(setId, pageNumber)) {
    if (!preset.opaque) continue
    ctx.fillStyle = '#fff'
    ctx.fillRect(
      preset.x * canvas.width,
      preset.y * canvas.height,
      preset.width * canvas.width,
      preset.height * canvas.height,
    )
  }

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

/** 쪽에 미리 놓인 칸의 id — 사용자가 실제로 쓰기 전까지는 저장하지 않는다 */
const presetBoxId = (presetId: string) => `preset:${presetId}`

function PageOverlay({
  field,
  textBoxes,
  presets,
  mode,
  tool,
  color,
  size,
  onChange,
  onTextBoxesChange,
}: {
  field: Field
  textBoxes: BinderTextBox[]
  presets: readonly BinderTextPreset[]
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
  const lastCountedTapRef = useRef(0)
  const editable = mode === 'text'
  // 인쇄된 괘선을 가리는 자리 — 쓰기 시작해 저장된 뒤에도 계속 가려야 한다
  const opaqueBoxIds = new Set(
    presets.filter((preset) => preset.opaque).map((preset) => presetBoxId(preset.id)),
  )
  // 쪽에 미리 놓인 빈 칸 — 아직 손대지 않은 것만 얹는다(쓰기 시작하면 저장된 칸이 대신한다)
  const presetBoxes: (BinderTextBox & { preset: true })[] = presets
    .filter((preset) => !textBoxes.some((box) => box.id === presetBoxId(preset.id)))
    .map((preset) => ({
      id: presetBoxId(preset.id),
      x: preset.x,
      y: preset.y,
      width: preset.width,
      height: preset.height,
      text: '',
      preset: true,
    }))
  const presetBoxesRef = useRef(presetBoxes)
  useEffect(() => {
    presetBoxesRef.current = presetBoxes
  })
  const allTextBoxes = [...textBoxes, ...presetBoxes]
  const visibleActiveTextBoxId =
    editable && allTextBoxes.some((box) => box.id === activeTextBoxId) ? activeTextBoxId : null
  const visibleTextBoxes = draftTextBox
    ? allTextBoxes.map((box) => (box.id === draftTextBox.id ? { ...box, ...draftTextBox } : box))
    : allTextBoxes

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

    // 손가락으로는 획을 그리지 않으므로(펜 전용) 기본 동작을 그대로 둬서 스크롤이 되게 한다.
    // 펜 터치일 때만 차단해 네이티브 제스처가 획을 끊지 않도록 한다.
    const onTouchStart = (event: TouchEvent) => {
      if (!IS_IOS || inkPropsRef.current.mode !== 'ink') return
      const stylus = findStylus(event.changedTouches)
      if (!stylus) return
      event.preventDefault()
      activeTouchIdRef.current = stylus.identifier
      rectRef.current = canvas.getBoundingClientRect()
      beginAt(stylus.clientX, stylus.clientY, stylus.force)
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!IS_IOS) return
      const touch = findActive(event.changedTouches)
      if (!touch) return
      event.preventDefault()
      moveAt(touch.clientX, touch.clientY, touch.force)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!IS_IOS) return
      const touch = findActive(event.changedTouches)
      if (!touch) return
      event.preventDefault()
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

  // 미리 놓인 칸은 여기서 처음으로 저장 대상이 된다 — 빈 칸은 저장하지 않는다
  const updateTextBox = (id: string, patch: Partial<BinderTextBox>) => {
    const current = textBoxesRef.current
    if (current.some((box) => box.id === id)) {
      onTextBoxesChange(current.map((box) => (box.id === id ? { ...box, ...patch } : box)))
      return
    }
    const preset = presetBoxesRef.current.find((box) => box.id === id)
    if (!preset) return
    // 화면 표시용 플래그는 빼고 저장한다
    const stored: BinderTextBox = {
      id: preset.id,
      x: preset.x,
      y: preset.y,
      width: preset.width,
      height: preset.height,
      text: preset.text,
    }
    onTextBoxesChange([...current, { ...stored, ...patch }])
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

  // pointerup과 click 양쪽에서 호출된다. 한쪽이 유실돼도 탭이 세어지도록 이중으로 받고,
  // 같은 탭에서 둘 다 오면 뒤엣것은 버린다.
  const handleOverlayTap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || draggingTextBoxRef.current) return
    if (event.target !== event.currentTarget) return

    const now = Date.now()
    if (now - lastCountedTapRef.current < SAME_TAP_MS) return
    lastCountedTapRef.current = now

    const previous = lastTapRef.current
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
      onClick={handleOverlayTap}
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
          const isPreset = 'preset' in box && box.preset === true
          // 괘선을 가리는 칸은 타이핑할 때만 흰 바탕이 된다 — 손글씨 모드에서는 줄이 그대로 보인다
          const opaque = editable && opaqueBoxIds.has(box.id)
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
                className={`binder-text-box h-full w-full resize-none rounded-lg border px-2.5 py-2 text-[16px] leading-relaxed text-rose-ink outline-none transition-colors placeholder:text-rose-key/60 ${
                  box.height ? '' : 'min-h-12'
                } ${
                  active && opaque
                    ? 'border-rose-accent bg-white shadow-sm'
                    : active
                      ? 'border-rose-accent bg-white/70 shadow-sm backdrop-blur-[1px]'
                      : opaque
                        ? 'border-transparent bg-white'
                        : isPreset && editable
                          ? 'border-dashed border-rose-line/70 bg-white/25'
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
                    {/* 쪽에 미리 놓인 칸은 지워도 다시 나타나므로 삭제 버튼을 두지 않는다 */}
                    {!isPreset && (
                      <button
                        type="button"
                        onClick={() => deleteTextBox(box.id)}
                        className="rounded-full px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-chip"
                      >
                        {t('binderDelete')}
                      </button>
                    )}
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
        {editable && allTextBoxes.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-ink/70 px-4 py-1.5 text-[13px] font-bold text-white shadow-sm backdrop-blur-[2px]">
            {t('binderTapToInput')}
          </div>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full rounded-2xl ${mode === 'ink' ? 'pointer-events-auto' : 'pointer-events-none'}`}
        // 세로 스크롤은 손가락에 열어두고, 펜 획은 위 핸들러의 preventDefault로 지킨다
        style={{ touchAction: 'pan-y' }}
        onPointerDown={startStroke}
      />
    </div>
  )
}

function PdfThumbnail({
  pdfDocument,
  pageNumber,
  label,
  active,
}: {
  pdfDocument: PdfDocument | null
  pageNumber: number
  /** 배지에 보여줄 쪽 번호 — 숨긴 쪽을 뺀 화면 번호다 */
  label: number
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
        {label}
      </span>
    </div>
  )
}

function PdfPage({
  pdfDocument,
  pageNumber,
  field,
  textBoxes,
  presets,
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
  presets: readonly BinderTextPreset[]
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
        presets={presets}
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
  const workOwnerId = userId ?? BINDER_LOCAL_OWNER
  const [selectedId, setSelectedId] = useState(binderSetList[0]?.id ?? '')
  const [ownedWork, setOwnedWork] = useState<{ ownerId: string; work: BinderWork } | null>(null)
  const work = ownedWork?.ownerId === workOwnerId ? ownedWork.work : null
  const setWork = useCallback(
    (next: BinderWork | null) => {
      setOwnedWork(next ? { ownerId: workOwnerId, work: next } : null)
    },
    [workOwnerId],
  )
  const [document, setDocument] = useState<PdfDocument | null>(null)
  // 뷰어 wrapper의 세로 길이를 PDF 쪽과 영상 인터스티셜 사이에서 항상 같게 유지하기 위해
  // 이 권의 첫 쪽 viewport를 그대로 aspect-ratio로 쓴다. 로드 실패나 최초 렌더는
  // A4 기본값(595.276 × 841.89)으로 폴백해 화살표 위치가 튀지 않게 한다.
  const [pdfAspect, setPdfAspect] = useState<{ width: number; height: number }>({
    width: 595.276,
    height: 841.89,
  })
  const [inkTool, setInkTool] = useState<InkTool>('pen')
  const [inkColor, setInkColor] = useState(PEN_COLORS[0])
  const [inkSize, setInkSize] = useState(4)
  // 입력 방식은 페이지가 아니라 세션의 도구 상태 — 쪽을 넘겨도 유지된다
  const [inputMode, setInputMode] = useState<FieldMode>('text')
  const [viewDir, setViewDir] = useState<'forward' | 'backward'>('forward')
  const [videosOpen, setVideosOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareSelected, setShareSelected] = useState<number[]>([])
  const [shareExtraPages, setShareExtraPages] = useState<number[]>([])
  const [shareExtraInput, setShareExtraInput] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(binderSetList[0]?.pdfPages ?? 1)
  const [hiddenPages, setHiddenPages] = useState<number[]>([])
  const [hiddenPagesSetId, setHiddenPagesSetId] = useState('')
  const [hiddenPagesLoadFailedSetId, setHiddenPagesLoadFailedSetId] = useState<string | null>(null)
  const [adminModeUserId, setAdminModeUserId] = useState<string | null>(null)
  const [hiddenSaving, setHiddenSaving] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(true)
  const [bootReadyUserId, setBootReadyUserId] = useState<string | null>(null)
  const [previewDragging, setPreviewDragging] = useState(false)
  const [workSaveError, setWorkSaveError] = useState<string | null>(null)
  const previewDragRef = useRef<{ startX: number; startIndex: number; lastPage: number } | null>(null)
  const previewMovedRef = useRef(false)
  const activeCheckpointRef = useRef<HTMLButtonElement | null>(null)
  // 이어보기: 부팅 복원이 끝나기 전에는 마지막 위치를 저장하지 않는다
  const bootRef = useRef(true)
  const legacyResumeRef = useRef<{ setId: string; page: number } | null>(null)
  // 권을 바꾼 뒤 사용자가 직접 페이지를 넘겼으면 복원으로 되돌리지 않는다
  const navigatedSinceSelectRef = useRef(false)
  const workRef = useRef<BinderWork | null>(null)
  const workOwnerRef = useRef(workOwnerId)
  const workDrainRef = useRef(new LatestValueDrain<PendingBinderSave>())
  const adminTapRef = useRef({ count: 0, deadline: 0 })
  const hiddenLoadRef = useRef(0)
  const selectedSetIdRef = useRef(selectedId)

  const flushWork = useCallback(async () => {
    try {
      await workDrainRef.current.flush(async (pending) => {
        await putBinderWork(pending.work, pending.ownerId)
      })
      if (!workDrainRef.current.getPending()) setWorkSaveError(null)
    } catch (error) {
      setWorkSaveError(t('binderSaveFailed'))
      throw error
    }
  }, [])

  const persistWork = useCallback((next: BinderWork, ownerId?: string) => {
    workDrainRef.current.schedule({ work: next, ownerId })
    void flushWork().catch((error) => {
      console.warn('Binder save remains pending for retry.', error)
    })
  }, [flushWork])

  useEffect(() => {
    const reportBestEffortFailure = (error: unknown) => {
      console.warn('Binder lifecycle flush could not finish.', error)
    }
    const onPageHide = () => {
      void flushWork().catch(reportBestEffortFailure)
    }
    const onVisibilityChange = () => {
      if (window.document.visibilityState === 'hidden') {
        void flushWork().catch(reportBestEffortFailure)
      }
    }
    const unregister = registerSaveFlush(flushWork)
    window.addEventListener('pagehide', onPageHide)
    window.document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unregister()
      window.removeEventListener('pagehide', onPageHide)
      window.document.removeEventListener('visibilitychange', onVisibilityChange)
      void flushWork().catch(reportBestEffortFailure)
    }
  }, [flushWork])

  const handleSignOut = useCallback(async () => {
    try {
      await flushWork()
      await signOut()
    } catch (error) {
      console.warn('Binder sign-out was blocked by an unfinished save.', error)
      setWorkSaveError(t('binderSignOutBlocked'))
    }
  }, [flushWork, signOut])

  useEffect(() => {
    workOwnerRef.current = workOwnerId
    workRef.current = work
  }, [work, workOwnerId])

  // 쪽 위 입력칸이 인쇄된 본문과 같은 글꼴로 보이도록 바인더 화면에서 받아온다
  useEffect(() => {
    ensureBinderFont()
  }, [])

  const selected = findBinderSet(selectedId) ?? binderSetList[0]
  const selectedPdfId = selected.pdfId
  const selectedPdfPages = selected.pdfPages
  const adminMode = adminModeUserId !== null && adminModeUserId === userId
  const hiddenPagesReady = hiddenPagesSetId === selected.pdfId
  const hiddenPagesWritable = hiddenPagesReady && hiddenPagesLoadFailedSetId !== selected.pdfId
  // 이 파트가 보여주는 PDF 쪽 범위 — 한 PDF를 파트로 나눠도 나머지 로직은 그대로 쓴다
  const lastPage = Math.min(pageCount, selected.pageEnd)
  const firstPage = Math.min(selected.pageStart, lastPage)
  const allPages = Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index)
  const currentHiddenPages = hiddenPagesReady ? hiddenPages : []
  const hiddenPageSet = new Set(currentHiddenPages.filter((page) => page <= pageCount))
  const visiblePages = allPages.filter((page) => !hiddenPageSet.has(page))
  const browsablePages = hiddenPagesReady ? (adminMode ? allPages : visiblePages) : []
  const browsableIndex = browsablePages.indexOf(pageNumber)
  // 관리자가 숨긴 쪽을 뺀 뒤 다시 센 쪽 번호 — 화면·공유에 보이는 모든 쪽 수가 이 값이다
  const visibleOrdinal = visiblePages.indexOf(pageNumber) + 1
  const displayPage = (page: number) => {
    const ordinal = visiblePages.indexOf(page) + 1
    return ordinal > 0 ? ordinal : null
  }
  const pageFromDisplay = (ordinal: number) => visiblePages[ordinal - 1]
  const allPagesHidden = visiblePages.length === 0
  const currentPageHidden = hiddenPageSet.has(pageNumber)
  const previousPage = browsableIndex > 0 ? browsablePages[browsableIndex - 1] : undefined
  const nextPage =
    browsableIndex >= 0 && browsableIndex + 1 < browsablePages.length
      ? browsablePages[browsableIndex + 1]
      : undefined
  // 이 쪽에 붙는 요약 영상 — 쪽 위에 카드로 얹어 영상을 보면서 바로 적을 수 있다
  const currentPageVideo = lessonVideoBeforePage(selected.pdfId, pageNumber)
  const canGoPrev = previousPage !== undefined
  const canGoNext = nextPage !== undefined
  const pageKey = String(pageNumber)
  const pageInput = work?.pageInputs[pageKey] ?? emptyField()
  const pageTextBoxes = work?.pageTextBoxes[pageKey] ?? []
  // 쪽에 미리 놓이는 입력칸 — 성경묵상 묵상·배우자 기도 칸, 디모데·책공부 괘선 노트
  const pagePresets = textPresetsFor(selected.pdfId, pageNumber)
  // 체크포인트는 "구간"의 시작점 — 다음 체크포인트 직전까지가 그 구간이다
  const checkpoints: BinderCheckpoint[] = checkpointsForSet(selected)
  const checkpointSections = checkpoints.map((checkpoint, index, list) => ({
    ...checkpoint,
    endPage: index + 1 < list.length ? list[index + 1].page - 1 : lastPage,
  }))
  const activeCheckpointId =
    [...checkpointSections].reverse().find((section) => pageNumber >= section.page)?.id ?? ''
  const activeCheckpoint = checkpointSections.find((section) => section.id === activeCheckpointId)

  useEffect(() => {
    selectedSetIdRef.current = selected.pdfId
  }, [selected.pdfId])

  useEffect(() => {
    activeCheckpointRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeCheckpointId])

  // 숨긴 쪽은 PDF 단위로 관리한다 — 같은 PDF를 나눈 파트끼리 설정이 갈라지지 않는다
  useEffect(() => {
    const requestId = ++hiddenLoadRef.current
    const pdfId = selected.pdfId
    let alive = true

    getHiddenPages(pdfId)
      .then((pages) => {
        if (!alive || requestId !== hiddenLoadRef.current || pdfId !== selected.pdfId) return
        setHiddenPages(pages)
        setHiddenPagesSetId(pdfId)
        setHiddenPagesLoadFailedSetId(null)
      })
      .catch(() => {
        if (!alive || requestId !== hiddenLoadRef.current) return
        setHiddenPages([])
        setHiddenPagesSetId(pdfId)
        setHiddenPagesLoadFailedSetId(pdfId)
      })

    return () => {
      alive = false
    }
  }, [selected.pdfId])

  useEffect(() => {
    if (adminMode || hiddenPagesSetId !== selected.pdfId || !hiddenPages.includes(pageNumber)) return
    const hidden = new Set(hiddenPages)
    const available = allPages.filter((page) => !hidden.has(page))
    const target = snapToVisiblePage(available, pageNumber)
    if (target === null) return
    const timer = window.setTimeout(() => setPageNumber(target), 0)
    return () => window.clearTimeout(timer)
    // allPages는 매 렌더 새 배열이라 의존성에서 뺀다 — 값은 아래 의존성으로 결정된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMode, hiddenPages, hiddenPagesSetId, firstPage, lastPage, pageNumber, selected.pdfId])

  const previewPages = nearbyPages(browsablePages, pageNumber)
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
  // 공유 후보: 필기한 쪽 + 책갈피 쪽 + 현재 쪽 + 직접 추가한 쪽 (이 파트 안에서만)
  const shareCandidates = hiddenPagesReady
    ? [...new Set([pageNumber, ...inputPageSet, ...bookmarkPageSet, ...shareExtraPages])]
        .filter((page) => page >= firstPage && page <= lastPage && !hiddenPageSet.has(page))
        .sort((a, b) => a - b)
    : []

  // 부팅 시 로컬 옛 데이터를 먼저 옮긴 뒤 계정의 마지막 사용 세트로 이동
  useEffect(() => {
    if (!userId) return
    let alive = true
    const restore = async () => {
      try {
        await migrateLocalBinderWorks(userId)
        const setId = await getLastBinderBookId(userId, isKnownBinderSetId)
        if (!alive) return
        if (setId) {
          setSelectedId(setId)
          return
        }

        const legacyId = await getLastBinderBookId(userId)
        if (!legacyId || isKnownBinderSetId(legacyId)) return
        const legacyWork = await getBinderWork(legacyId, userId)
        if (!alive) return
        const resume = resolveLegacyResume(legacyId, legacyWork.lastPageNumber)
        if (!resume || !isKnownBinderSetId(resume.setId)) return
        legacyResumeRef.current = resume
        setSelectedId(resume.setId)
      } catch (error) {
        // 복원 실패 시 첫 세트를 그대로 열어 바인더 사용을 막지 않는다.
        console.warn('Binder startup restoration failed.', error)
      } finally {
        if (alive) setBootReadyUserId(userId)
      }
    }
    void restore()
    return () => {
      alive = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId || bootReadyUserId !== userId) return
    let alive = true
    navigatedSinceSelectRef.current = false
    const resetTimer = window.setTimeout(() => {
      if (alive) {
        setWork(null)
        setPageNumber(selected.pageStart)
      }
    }, 0)
    getBinderWork(selected.workId, userId)
      .then((loaded) => {
        if (!alive) return
        window.clearTimeout(resetTimer)
        const converted = convertLegacyPageText(loaded)
        const next = converted.work
        // 이 권에서 마지막으로 보던 쪽으로 이어보기 (이미 직접 넘겼으면 유지).
        // 한 PDF를 파트로 나눠 쓰면 마지막 쪽이 다른 파트일 수 있어 파트 범위로 맞춘다.
        const legacyResume =
          legacyResumeRef.current?.setId === selected.id
            ? legacyResumeRef.current.page
            : undefined
        if (legacyResume !== undefined) legacyResumeRef.current = null
        const target =
          legacyResume ??
          (next.lastPageNumber && next.lastPageNumber > 0 ? next.lastPageNumber : selected.pageStart)
        const restored = clamp(target, selected.pageStart, selected.pageEnd)
        if (!navigatedSinceSelectRef.current) setPageNumber(restored)

        if (bootRef.current) {
          // 부팅 복원: 열람만으로 최근 사용 순서를 바꾸지 않는다
          bootRef.current = false
          workOwnerRef.current = workOwnerId
          workRef.current = next
          setWork(next)
          if (converted.changed) persistWork(next, userId)
          return
        }
        // 사용자가 직접 고른 권: 페이지를 안 넘겨도 "마지막 사용 권"으로 기록
        const touched = { ...next, lastPageNumber: restored }
        workOwnerRef.current = workOwnerId
        workRef.current = touched
        setWork(touched)
        persistWork(touched, userId)
      })
      .catch(() => {
        if (alive) setWorkSaveError(t('binderSaveFailed'))
      })
    return () => {
      alive = false
      window.clearTimeout(resetTimer)
    }
  }, [
    bootReadyUserId,
    persistWork,
    selected.id,
    selected.pageEnd,
    selected.pageStart,
    selected.workId,
    setWork,
    userId,
    workOwnerId,
  ])

  // 마지막으로 보던 권·쪽 저장 — 계정별 이어보기용.
  // 체크포인트는 늘 구간 첫 쪽으로 가므로 구간별 위치(checkpointPages)는 더 쓰지 않는다.
  // 예전 기록은 그대로 두고 읽지도 쓰지도 않는다.
  useEffect(() => {
    if (!userId || bootRef.current) return
    const timer = window.setTimeout(() => {
      const current = workRef.current
      if (!current || workOwnerRef.current !== workOwnerId || current.bookId !== selected.workId)
        return
      if (current.lastPageNumber === pageNumber) return
      const next: BinderWork = { ...current, lastPageNumber: pageNumber }
      workRef.current = next
      setWork(next)
      persistWork(next, userId)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [pageNumber, persistWork, selected.workId, setWork, userId, workOwnerId])

  // PDF는 파일 단위로 연다 — 같은 PDF를 나눈 파트끼리 전환할 때는 다시 받지 않는다
  useEffect(() => {
    let alive = true
    const resetTimer = window.setTimeout(() => {
      if (!alive) return
      setDocument(null)
      setPageCount(selectedPdfPages)
      setLoadingPdf(true)
    }, 0)
    const task = pdfjsLib.getDocument({ url: binderPdfUrl(selectedPdfId) })
    task.promise
      .then(async (next) => {
        if (!alive) return
        try {
          const firstPage = await next.getPage(1)
          if (!alive) return
          const vp = firstPage.getViewport({ scale: 1 })
          setPdfAspect({ width: vp.width, height: vp.height })
        } catch {
          // 첫 쪽 viewport 조회 실패 시에는 초기 A4 값을 그대로 둔다
        }
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
  }, [selectedPdfId, selectedPdfPages])

  const updateWork = (next: BinderWork) => {
    setWork(next)
    persistWork(next, user?.id)
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
    const fallback = t('binderPage')(displayPage(pageNumber) ?? visibleOrdinal)
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
    if (previousPage === undefined) return
    navigatedSinceSelectRef.current = true
    setViewDir('backward')
    setPageNumber(previousPage)
  }
  const goNext = () => {
    if (nextPage === undefined) return
    navigatedSinceSelectRef.current = true
    setViewDir('forward')
    setPageNumber(nextPage)
  }
  const goToPage = (next: number) => {
    const target = snapToVisiblePage(browsablePages, clamp(next, firstPage, lastPage))
    if (target === null) return
    setViewDir(target >= pageNumber ? 'forward' : 'backward')
    navigatedSinceSelectRef.current = true
    setPageNumber(target)
  }
  /** 체크포인트를 누르면 늘 그 구간의 첫 쪽으로 간다 — 어디를 눌러도 결과가 같다 */
  const goToCheckpoint = (checkpointId: string) => {
    const section = checkpointSections.find((item) => item.id === checkpointId)
    if (!section) return
    if (adminMode) {
      goToPage(section.page)
      return
    }
    const nextVisible = visiblePages.find((page) => page >= section.page)
    goToPage(nextVisible ?? section.page)
  }

  const handleAdminTap = () => {
    // 이벤트가 발생한 실제 시각으로 2초 탭 창을 계산한다.
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now()
    const taps = adminTapRef.current
    if (now > taps.deadline) {
      taps.count = 1
      taps.deadline = now + ADMIN_TAP_WINDOW_MS
      return
    }

    taps.count += 1
    if (taps.count < ADMIN_TAP_COUNT) return
    taps.count = 0
    taps.deadline = 0
    if (!userId) return

    void isBinderAdmin(userId).then((allowed) => {
      if (!allowed) return
      if (adminMode) {
        exitAdminMode()
      } else {
        setAdminModeUserId(userId)
      }
      navigator.vibrate?.(40)
    })
  }

  const exitAdminMode = () => {
    setAdminModeUserId(null)
    // 관리자만 볼 수 있는 숨김 쪽에 머물러 있다가 종료했을 때 일반 뷰에 이상한 쪽이 남지 않도록 스냅
    const target = snapToVisiblePage(visiblePages, pageNumber)
    if (target !== null) setPageNumber(target)
  }

  const handleRestoreAll = () => {
    if (hiddenSaving || currentHiddenPages.length === 0 || !hiddenPagesWritable) return
    // 파급이 큰 동작이라 확인 한 단계를 둔다
    if (!window.confirm(t('binderRestoreAllConfirm')(currentHiddenPages.length))) return
    void saveHiddenPages([])
  }

  const saveHiddenPages = async (nextPages: number[]) => {
    if (!userId || hiddenSaving || !hiddenPagesWritable) return
    const setId = selected.pdfId
    const previousPages = currentHiddenPages
    const normalized = [...new Set(nextPages)].sort((a, b) => a - b)
    setHiddenPages(normalized)
    setHiddenPagesSetId(setId)
    setHiddenSaving(true)
    try {
      await putHiddenPages(setId, normalized, userId)
    } catch {
      if (selectedSetIdRef.current === setId) {
        setHiddenPages(previousPages)
        setHiddenPagesSetId(setId)
      }
      window.alert(t('binderHiddenSaveFailed'))
    } finally {
      setHiddenSaving(false)
    }
  }

  const toggleCurrentPageHidden = () => {
    if (!adminMode) return
    const next = currentPageHidden
      ? currentHiddenPages.filter((page) => page !== pageNumber)
      : [...currentHiddenPages, pageNumber]
    void saveHiddenPages(next)
  }

  const restoreHiddenPage = (page: number) => {
    void saveHiddenPages(currentHiddenPages.filter((hiddenPage) => hiddenPage !== page))
  }

  const startPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (loadingPdf || !document || browsablePages.length === 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    previewMovedRef.current = false
    const startIndex = Math.max(0, browsablePages.indexOf(pageNumber))
    previewDragRef.current = { startX: event.clientX, startIndex, lastPage: pageNumber }
    setPreviewDragging(true)
  }

  const movePreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current
    if (!drag) return
    event.preventDefault()
    // 썸네일 한 칸 폭(약 60px)마다 1쪽 — 살짝 움직인 건 탭으로 취급되도록 trunc 사용
    const pageDelta = Math.trunc((drag.startX - event.clientX) / 60)
    const nextIndex = clamp(drag.startIndex + pageDelta, 0, browsablePages.length - 1)
    const draggedPage = browsablePages[nextIndex]
    if (draggedPage === undefined || draggedPage === drag.lastPage) return
    previewMovedRef.current = true
    navigatedSinceSelectRef.current = true
    drag.lastPage = draggedPage
    setPageNumber(draggedPage)
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
      const target = window.document.elementFromPoint(event.clientX, event.clientY)
      const hit = target?.closest('[data-preview-page]')
      const page = hit ? Number(hit.getAttribute('data-preview-page')) : NaN
      if (!Number.isNaN(page)) goToPage(page)
    }
  }

  const openShare = () => {
    if (!hiddenPagesReady) return
    const page = snapToVisiblePage(visiblePages, pageNumber)
    setShareSelected(page === null ? [] : [page])
    setShareExtraInput('')
    setShareOpen(true)
  }

  const toggleSharePage = (page: number) => {
    setShareSelected((prev) => (prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]))
  }

  // 입력값은 화면에 보이는 쪽 번호다 — 숨긴 쪽을 뺀 순번으로 해석한다
  const addShareExtraPage = () => {
    const ordinal = Number(shareExtraInput)
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > visiblePages.length) return
    const page = pageFromDisplay(ordinal)
    if (page === undefined) return
    setShareExtraPages((prev) => (prev.includes(page) ? prev : [...prev, page]))
    setShareSelected((prev) => (prev.includes(page) ? prev : [...prev, page]))
    setShareExtraInput('')
  }

  const sharePages = async () => {
    const selectedVisiblePages = shareSelected.filter((page) => !hiddenPageSet.has(page))
    if (!hiddenPagesReady || !document || shareBusy || selectedVisiblePages.length === 0) return
    setShareBusy(true)
    try {
      await window.document.fonts?.ready
      const displayWidth =
        window.document.querySelector('article canvas')?.getBoundingClientRect().width ?? 720
      const pages = [...selectedVisiblePages].sort((a, b) => a - b)
      const files: File[] = []
      // 파일 이름·공유 문구의 쪽 번호도 화면과 같은(숨긴 쪽을 뺀) 번호를 쓴다
      for (const page of pages) {
        const canvas = await renderSharePage(document, selected.pdfId, page, work, displayWidth)
        const ordinal = displayPage(page) ?? page
        files.push(
          await canvasToJpegFile(
            canvas,
            `eda-${selected.id}-p${String(ordinal).padStart(3, '0')}.jpg`,
          ),
        )
      }
      const result = await shareOrDownloadFiles(
        files,
        t('binderShareTitle')(t('binderSetTitle')(selected.kind)),
        t('binderShareText')(
          t('binderSetTitle')(selected.kind),
          pages.map((page) => t('binderPage')(displayPage(page) ?? page)).join(', '),
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
        {/* 관리자 모드 지속 신호 — 스크롤 위치와 무관하게 늘 보이는 상단 stripe */}
        {adminMode && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-rose-accent-deep" />
        )}
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex w-24 shrink-0 items-center">
            {__APP_TARGET__ === 'all' ? (
              <BackButton to="/" label={t('navBackHome')} />
            ) : (
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">EDA</span>
                <span className="font-mono text-[9px] text-rose-key/45">v{__BUILD__}</span>
              </span>
            )}
          </div>
          <h1
            onClick={handleAdminTap}
            className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold"
          >
            {t('binderAppTitle')}
          </h1>
          <div className="flex shrink-0 items-center justify-end gap-1">
            {adminMode && (
              <button
                type="button"
                onClick={exitAdminMode}
                className="flex shrink-0 items-center gap-1 rounded-full bg-rose-accent-deep px-2.5 py-1.5 text-[12px] font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95 sm:px-3 sm:text-[13px]"
                aria-label={t('binderExitAdmin')}
              >
                <span aria-hidden>🛡</span>
                <span className="hidden sm:inline">{t('binderExitAdmin')}</span>
                <span aria-hidden className="sm:hidden">✕</span>
              </button>
            )}
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
                onClick={() => void handleSignOut()}
                className="whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent"
              >
                {t('binderLogout')}
              </button>
            )}
          </div>
        </div>
      </header>

      {workSaveError && (
        <div aria-live="polite" className="mx-auto mt-3 max-w-6xl px-4">
          <p className="rounded-xl border border-rose-accent/40 bg-rose-card px-3 py-2 text-sm font-bold text-rose-accent shadow-sm">
            {workSaveError}
          </p>
        </div>
      )}

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start">
        {/* 폰·태블릿에서는 세트 선택 → 체크포인트를 헤더 바로 아래로 올린다.
            세트 표지 카드는 툴바에 같은 제목이 나오는 태블릿 구간에서만 숨긴다. */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-[66px] xl:self-start">
          <section className="relative order-3 overflow-hidden rounded-2xl border border-rose-line bg-rose-card p-5 pl-7 sm:hidden xl:order-1 xl:block">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-rose-accent" />
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black tracking-[0.3em] text-rose-key/80">EDA · SPL</p>
              <span className="rounded-full bg-rose-chip px-2.5 py-0.5 text-[11px] font-black text-rose-accent">
                {t('binderSetPages')(selected.pages)}
              </span>
            </div>
            <p className="mt-3 break-keep font-serif text-[23px] font-extrabold leading-snug">
              {t('binderSetTitle')(selected.kind)}
            </p>
          </section>

          <section className="order-1 overflow-hidden rounded-2xl border border-rose-line bg-rose-card xl:order-2">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="flex items-center gap-2 font-serif text-base font-extrabold">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                {t('binderSetSelect')}
              </h2>
              <span className="text-xs font-bold text-rose-key/80">{t('binderSetCount')(binderSetList.length)}</span>
            </div>
            <div className="space-y-1.5 px-3 pb-3 pt-2">
              {binderSetList.map((set) => {
                const active = selected.id === set.id
                const title = t('binderSetTitle')(set.kind)
                return (
                  <button
                    type="button"
                    key={set.id}
                    onClick={() => setSelectedId(set.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      active
                        ? 'border-rose-accent-deep bg-rose-accent-deep text-white shadow-md shadow-rose-accent/20'
                        : 'border-rose-line bg-rose-bg text-rose-key hover:border-rose-accent/50 hover:text-rose-accent'
                    }`}
                    aria-label={t('binderSelectSetAria')(title)}
                  >
                    <span className="min-w-0 truncate font-serif text-sm font-extrabold">{title}</span>
                    <span className={`shrink-0 text-xs font-bold ${active ? 'text-white/75' : 'text-rose-key/60'}`}>
                      {t('binderSetPages')(set.pages)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {getLang() === 'en' && (
            <p className="order-2 rounded-xl border border-rose-line bg-rose-chip/50 px-3 py-2.5 text-[13px] font-bold leading-5 text-rose-key xl:order-3">
              {t('binderEnglishCoverageNotice')}
            </p>
          )}

          <section className="order-2 rounded-2xl border border-rose-line bg-rose-card p-3 xl:order-3">
            <div className="mb-2 flex items-center justify-between px-1.5">
              <h2 className="flex items-center gap-2 font-serif text-base font-extrabold">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                {t('binderCheckpoint')}
              </h2>
              <button
                type="button"
                onClick={addBookmark}
                disabled={browsablePages.length === 0}
                className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-accent-deep hover:text-white"
              >
                {t('binderAddBookmark')}
              </button>
            </div>
            {/* 제목이 긴 세트(디모데·책공부)에서도 한 글자만 보이지 않도록 좁은 폭은 한 줄에
                하나씩 놓고, 잘라내는 대신 여러 줄로 감싼다 */}
            <div className="grid max-h-[38vh] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 xl:grid-cols-1">
              {checkpointSections.map((checkpoint) => {
                const active = activeCheckpointId === checkpoint.id
                const ordinal = displayPage(checkpoint.page)
                return (
                  <button
                    type="button"
                    key={checkpoint.id}
                    ref={active ? activeCheckpointRef : null}
                    onClick={() => goToCheckpoint(checkpoint.id)}
                    title={ordinal ? `${checkpoint.label} · ${t('binderPage')(ordinal)}` : checkpoint.label}
                    className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm leading-snug transition focus:outline-none focus:ring-2 focus:ring-rose-accent ${
                      active
                        ? 'bg-rose-chip font-extrabold text-rose-accent'
                        : 'font-bold text-rose-key hover:bg-rose-chip/50 hover:text-rose-ink'
                    }`}
                  >
                    <span className="min-w-0 flex-1 break-keep">{checkpoint.label}</span>
                    {ordinal !== null && (
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-rose-key/60">
                        {ordinal}
                      </span>
                    )}
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
                    const hidden = hiddenPageSet.has(bookmark.page) && !adminMode
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
                              hidden ? 'text-rose-key/45' : active ? 'text-rose-accent' : 'text-rose-key'
                            }`}
                          >
                            {bookmark.label}
                          </span>
                          {hidden && (
                            <span className="shrink-0 rounded-full bg-rose-bg px-1.5 py-0.5 text-[10px] font-bold text-rose-key/60">
                              {t('binderHiddenBadge')}
                            </span>
                          )}
                          <span className="shrink-0 text-xs tabular-nums text-rose-key/60">
                            {t('binderPage')(displayPage(bookmark.page) ?? bookmark.page)}
                          </span>
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

          {adminMode && (
            <section className="order-4 rounded-2xl border-2 border-rose-accent-deep/50 bg-rose-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 px-1.5">
                <h2 className="flex items-center gap-1.5 font-serif text-base font-extrabold text-rose-accent-deep">
                  <span aria-hidden>🚫</span>
                  {t('binderHiddenListTitle')}
                </h2>
                <button
                  type="button"
                  onClick={handleRestoreAll}
                  disabled={hiddenSaving || currentHiddenPages.length === 0 || !hiddenPagesWritable}
                  className="flex items-center gap-1 rounded-full border border-rose-accent-deep bg-white px-2.5 py-1 text-xs font-bold text-rose-accent-deep transition active:scale-95 disabled:opacity-40"
                >
                  <span aria-hidden>↩</span>
                  {t('binderRestoreAll')}
                </button>
              </div>
              {!hiddenPagesReady ? (
                <p className="mt-2 rounded-lg border border-dashed border-rose-line px-3 py-2 text-[13px] text-rose-key/80">
                  {t('binderHiddenLoading')}
                </p>
              ) : !hiddenPagesWritable ? (
                <p className="mt-2 rounded-lg border border-dashed border-rose-line px-3 py-2 text-[13px] text-rose-key/80">
                  {t('binderHiddenLoadFailed')}
                </p>
              ) : currentHiddenPages.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-rose-line px-3 py-2 text-[13px] text-rose-key/80">
                  {t('binderHiddenEmpty')}
                </p>
              ) : (
                <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                  {currentHiddenPages.map((page) => (
                    <div key={page} className="flex items-center gap-2 rounded-lg bg-rose-chip/60 px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => goToPage(page)}
                        className="min-w-0 flex-1 text-left text-sm font-bold text-rose-key"
                      >
                        {t('binderPage')(page)}
                      </button>
                      <button
                        type="button"
                        onClick={() => restoreHiddenPage(page)}
                        disabled={hiddenSaving}
                        className="flex items-center gap-1 rounded-full border border-rose-accent-deep bg-white px-2.5 py-1 text-xs font-bold text-rose-accent-deep transition active:scale-95 disabled:opacity-40"
                        aria-label={`${t('binderRestorePage')} ${t('binderPage')(page)}`}
                      >
                        <span aria-hidden>↩</span>
                        {t('binderRestorePage')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

        </aside>

        <section className="min-w-0 space-y-3">
          <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-line bg-rose-card/95 px-3.5 py-2.5 shadow-sm backdrop-blur">
            {/* 제목은 폰에서 숨김(헤더에 앱 이름이 있고, 툴바를 한 줄로 유지하기 위해) */}
            <h2 className="hidden min-w-0 flex-1 truncate font-serif text-lg font-extrabold sm:block">
              {t('binderSetTitle')(selected.kind)}
            </h2>
            <select
              value={activeCheckpointId}
              onChange={(event) => goToCheckpoint(event.target.value)}
              title={activeCheckpoint ? `${activeCheckpoint.label} · ${t('binderPage')(displayPage(activeCheckpoint.page) ?? activeCheckpoint.page)}` : t('binderShortcut')}
              className="min-h-11 min-w-0 max-w-[min(18rem,70vw)] flex-1 truncate rounded-full border border-rose-line bg-rose-bg px-3 py-1.5 text-[13px] font-bold text-rose-key outline-none focus:border-rose-accent focus:ring-2 focus:ring-rose-accent sm:flex-none"
              aria-label={t('binderCheckpointAria')}
            >
              <option value="" disabled>
                {t('binderShortcut')}
              </option>
              {checkpointSections.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpoint.label} · {t('binderPage')(displayPage(checkpoint.page) ?? checkpoint.page)}
                </option>
              ))}
            </select>
            <ModeToggle mode={inputMode} onChange={setInputMode} />
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-rose-chip px-3 py-1.5 text-[13px] font-bold text-rose-accent-deep transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-rose-accent"
              aria-label={t('binderGuideOpen')}
            >
              <span aria-hidden>?</span> {t('binderGuideEntry')}
            </button>
            {videoStagesFor(selected.pdfId) && (
              <button
                type="button"
                onClick={() => setVideosOpen(true)}
                className="flex shrink-0 items-center gap-1 rounded-full bg-rose-chip px-3 py-1.5 text-[13px] font-bold text-rose-accent-deep transition active:scale-95"
                aria-label={t('binderVideosAria')}
              >
                <span aria-hidden>🎬</span> {t('binderVideos')}
              </button>
            )}
            <button
              type="button"
              onClick={openShare}
              disabled={!hiddenPagesReady || visiblePages.length === 0}
              className="flex shrink-0 items-center gap-1 rounded-full bg-rose-accent-deep px-3 py-1.5 text-[13px] font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95"
            >
              <span aria-hidden>📤</span> {t('binderShare')}
            </button>

            {adminMode && (
              <div className="flex w-full items-center justify-between gap-2 border-t-2 border-rose-accent-deep/40 pt-2">
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                    currentPageHidden
                      ? 'bg-rose-accent-deep text-white'
                      : 'border border-rose-accent-deep/50 bg-rose-card text-rose-accent-deep'
                  }`}
                >
                  <span aria-hidden>{currentPageHidden ? '🚫' : '🛡'}</span>
                  {currentPageHidden ? t('binderHiddenPage') : t('binderAdminMode')}
                </span>
                {currentPageHidden ? (
                  <button
                    type="button"
                    onClick={toggleCurrentPageHidden}
                    disabled={hiddenSaving || !hiddenPagesWritable}
                    className="flex items-center gap-1 rounded-full border border-rose-accent-deep bg-white px-3 py-1.5 text-[13px] font-bold text-rose-accent-deep shadow-sm transition active:scale-95 disabled:opacity-40"
                  >
                    <span aria-hidden>↩</span>
                    {t('binderRestorePage')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleCurrentPageHidden}
                    disabled={hiddenSaving || !hiddenPagesWritable}
                    className="flex items-center gap-1 rounded-full bg-rose-accent-deep px-3 py-1.5 text-[13px] font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95 disabled:opacity-40"
                  >
                    <span aria-hidden>🚫</span>
                    {t('binderHidePage')}
                  </button>
                )}
              </div>
            )}

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
            {loadingPdf || !document || !hiddenPagesReady ? (
              <span className="text-sm font-bold text-rose-key">{t('binderPreviewLoading')}</span>
            ) : browsablePages.length === 0 ? (
              <span className="text-sm font-bold text-rose-key">{t('binderAllPagesHidden')}</span>
            ) : (
              previewPages.map((page) => {
                const active = page === pageNumber
                const hiddenThumb = adminMode && hiddenPageSet.has(page)
                const hasVideo = !!lessonVideoBeforePage(selected.pdfId, page)
                return (
                  <div
                    key={`p-${page}`}
                    data-preview-page={page}
                    className={`relative ${hiddenThumb ? 'opacity-40' : ''}`}
                  >
                    <PdfThumbnail
                      pdfDocument={document}
                      pageNumber={page}
                      label={displayPage(page) ?? page}
                      active={active}
                    />
                    {hasVideo && !hiddenThumb && (
                      <span
                        aria-hidden
                        className="absolute left-1 top-1 rounded-full bg-rose-ink/70 px-1 text-[9px] leading-4 text-white shadow-sm"
                      >
                        🎬
                      </span>
                    )}
                    {hiddenThumb && (
                      <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-rose-accent-deep px-1.5 py-0.5 text-[9px] font-black text-white shadow-sm">
                        <span aria-hidden>🚫</span>
                        {t('binderHiddenBadge')}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <article
            className={`relative min-h-[56vh] overflow-hidden rounded-3xl bg-rose-chip/50 p-2.5 sm:p-3 ${
              currentPageHidden && adminMode
                ? 'border-4 border-rose-accent-deep'
                : adminMode
                  ? 'border-2 border-rose-accent-deep/40'
                  : 'border border-rose-line'
            }`}
            style={{ touchAction: 'pan-y' }}
          >
            {/* 관리자 + 숨김 쪽일 때 프레임 위 배지 — 뷰어 안쪽 상단에 얹어 필기 영역과 분리, pointer-events-none으로 필기 방해 안 함 */}
            {currentPageHidden && adminMode && (
              <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col gap-0.5 rounded-xl bg-rose-accent-deep px-2.5 py-1.5 text-white shadow-lift">
                <span className="flex items-center gap-1 text-[11px] font-black tracking-wide">
                  <span aria-hidden>🚫</span>
                  {t('binderHiddenPage')}
                </span>
                <span className="truncate text-[10px] font-bold opacity-90">
                  {t('binderHiddenViewerNotice')}
                </span>
              </div>
            )}
            {loadingPdf || !hiddenPagesReady ? (
              <div className="grid min-h-[56vh] place-items-center rounded-2xl bg-rose-card text-rose-key">
                {t('binderOpening')}
              </div>
            ) : allPagesHidden && !adminMode ? (
              <div className="grid min-h-[56vh] place-items-center rounded-2xl bg-rose-card px-6 text-center font-bold text-rose-key">
                {t('binderAllPagesHidden')}
              </div>
            ) : (
              <>
                {/* 이 쪽에 붙는 요약 영상 — 쪽 위에 얹어 영상을 보면서 같은 화면에 적는다 */}
                {currentPageVideo && (
                  <BinderPageVideo
                    key={`${currentPageVideo.lesson.videoId}:${videosOpen ? 'modal-open' : 'modal-closed'}`}
                    stage={currentPageVideo.stage}
                    lesson={currentPageVideo.lesson}
                  />
                )}
                {/* 뷰어 wrapper — 드래그 훑기 중에는 잦은 pageNumber 변화로 애니메이션이
                    반복 재생돼 튀지 않도록 클래스를 뺀다. aspect-ratio는 PDF 첫 쪽 viewport로
                    잡아 좌우 화살표(top-1/2) 위치가 쪽마다 튀지 않게 한다. */}
                <div
                  className={previewDragging ? '' : `binder-view-enter-${viewDir}`}
                  style={{ aspectRatio: `${pdfAspect.width} / ${pdfAspect.height}` }}
                >
                  {document ? (
                    <PdfPage
                      pdfDocument={document}
                      pageNumber={pageNumber}
                      field={pageInput}
                      textBoxes={pageTextBoxes}
                      presets={pagePresets}
                      mode={inputMode}
                      tool={inkTool}
                      color={inkColor}
                      size={inkSize}
                      onChange={updatePageInput}
                      onTextBoxesChange={updatePageTextBoxes}
                    />
                  ) : (
                    <div className="grid h-full place-items-center rounded-2xl bg-rose-card text-rose-key">
                      {t('binderPdfError')}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 페이지 위에 떠 있는 좌우 넘김 — 아티클 안쪽에 고정해 좁은 폭에서도 뷰포트를 벗어나지 않는다.
                필기 중에는 숨긴다: 획이 버튼 위에서 시작하면 쪽이 넘어가 버린다 (하단 바로 이동 가능). */}
            {inputMode !== 'ink' && browsablePages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-lift transition active:scale-[0.98] disabled:opacity-40 sm:left-3 sm:h-12 sm:w-12"
                  aria-label={t('binderPrevPage')}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
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
              disabled={!canGoPrev}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-40"
              aria-label={t('binderPrevPage')}
            >
              ←
            </button>
            {/* 슬라이더도 화면에 보이는 쪽 순번으로 움직인다 — 숨긴 쪽에서 멈추지 않는다 */}
            <input
              type="range"
              min={1}
              max={Math.max(1, visiblePages.length)}
              step={1}
              value={Math.max(1, visibleOrdinal)}
              onChange={(event) => {
                const page = pageFromDisplay(Number(event.target.value))
                if (page !== undefined) goToPage(page)
              }}
              disabled={visiblePages.length === 0}
              className="pager-range min-w-0 flex-1"
              aria-label={t('binderPageMove')}
            />
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-accent-deep text-xl font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-40"
              aria-label={t('binderNextPage')}
            >
              →
            </button>
            <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-bold tabular-nums text-rose-key">
              <span>
                {/* 숨긴 쪽은 화면 번호가 없어 관리자에게만 원본 쪽을 보여준다 */}
                {currentPageHidden && adminMode
                  ? `${t('binderHiddenPage')} · ${pageNumber}`
                  : t('binderPagePosition')(visibleOrdinal, visiblePages.length)}
              </span>
            </span>
          </div>
        </section>

      </main>

      {videosOpen && (
        <BinderVideoSheet
          setId={selected.pdfId}
          currentPage={pageNumber}
          onClose={() => setVideosOpen(false)}
        />
      )}

      {guideOpen && (
        <BinderGuideSheet
          setId={selected.pdfId}
          setTitle={t('binderSetTitle')(selected.kind)}
          checkpoints={checkpoints}
          currentPage={pageNumber}
          pageCount={lastPage}
          displayPage={displayPage}
          onJumpPage={goToPage}
          onClose={() => setGuideOpen(false)}
        />
      )}

      {/* 바인더 공유 모달 */}
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
                    <PdfThumbnail
                      pdfDocument={document}
                      pageNumber={page}
                      label={displayPage(page) ?? page}
                      active={selectedPage}
                    />
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        selectedPage ? 'text-rose-accent' : 'text-rose-key'
                      }`}
                    >
                      {selectedPage ? '✓ ' : ''}
                      {t('binderPage')(displayPage(page) ?? page)} {inputPageSet.has(page) ? '✍️' : ''}
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
                max={visiblePages.length}
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
              {shareBusy ? t('binderMakingImages') : t('binderShareModalTitle')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
