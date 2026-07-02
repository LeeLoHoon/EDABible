import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { useAuth } from '../authState'
import { binderBooks, binderUrl } from '../binderLibrary'
import ModeToggle from '../components/ModeToggle'
import { getBinderWork, putBinderWork, type BinderBookmark, type BinderTextBox, type BinderWork } from '../db'
import { emptyField, type Field, type FieldMode, type Stroke } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>
type InkTool = 'pen' | 'eraser'

const PEN_COLORS = ['#2c2722', '#b25c30', '#2563eb', '#059669', '#be185d']

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

function nearbyPages(pageNumber: number, pageCount: number): number[] {
  const clamped = Math.max(1, Math.min(pageCount, pageNumber))
  const pages = new Set<number>()

  for (const page of [clamped - 1, clamped, clamped + 1]) {
    if (page >= 1 && page <= pageCount) pages.add(page)
  }

  for (let page = clamped + 2; pages.size < Math.min(3, pageCount) && page <= pageCount; page += 1) {
    pages.add(page)
  }

  for (let page = clamped - 2; pages.size < Math.min(3, pageCount) && page >= 1; page -= 1) {
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
  ctx.clearRect(0, 0, canvas.width, canvas.height)
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
  const fieldRef = useRef(field)
  const textBoxesRef = useRef(textBoxes)
  const [tool, setTool] = useState<InkTool>('pen')
  const [color, setColor] = useState(PEN_COLORS[0])
  const [size, setSize] = useState(4)
  const [activeTextBoxId, setActiveTextBoxId] = useState<string | null>(textBoxes[0]?.id ?? null)
  const visibleActiveTextBoxId = textBoxes.some((box) => box.id === activeTextBoxId)
    ? activeTextBoxId
    : (textBoxes[0]?.id ?? null)

  useEffect(() => {
    fieldRef.current = field
    const canvas = canvasRef.current
    if (canvas) drawStrokes(canvas, field.strokes)
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
      canvas.width = Math.max(1, Math.round(rect.width))
      canvas.height = Math.max(1, Math.round(rect.height))
      drawStrokes(canvas, fieldRef.current.strokes)
    }
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): [number, number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top, event.pressure || 0.5]
  }

  const eraseAt = (x: number, y: number) => {
    const threshold = Math.max(size * 2, 18)
    const kept = fieldRef.current.strokes.filter((stroke) => distToStroke(stroke, x, y) > threshold)
    if (kept.length === fieldRef.current.strokes.length) return
    const next = { ...fieldRef.current, strokes: kept }
    fieldRef.current = next
    onChange(next)
  }

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'ink') return
    if (event.pointerType === 'touch') return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    const [x, y, pressure] = pointFromEvent(event)
    if (tool === 'eraser') {
      eraseAt(x, y)
      return
    }
    drawingRef.current = { color, size, points: [[x, y, pressure]] }
  }

  const moveStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'ink') return
    const [x, y, pressure] = pointFromEvent(event)
    if (tool === 'eraser' && event.buttons) {
      eraseAt(x, y)
      return
    }
    const stroke = drawingRef.current
    if (!stroke) return
    stroke.points.push([x, y, pressure])
    const canvas = canvasRef.current
    if (canvas) drawStrokes(canvas, [...fieldRef.current.strokes, stroke])
  }

  const endStroke = () => {
    const stroke = drawingRef.current
    if (!stroke) return
    drawingRef.current = null
    const next = { ...fieldRef.current, strokes: [...fieldRef.current.strokes, stroke] }
    fieldRef.current = next
    onChange(next)
  }

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
                  <div className="mt-1 flex items-center gap-1 rounded-lg border border-rose-line bg-rose-card/90 p-1 shadow-sm">
                    <button
                      type="button"
                      onPointerDown={(event) => startMoveTextBox(event, box)}
                      className="cursor-grab rounded bg-rose-accent px-2 py-1 text-xs font-bold text-white active:cursor-grabbing"
                    >
                      이동
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { y: Math.max(0, box.y - 0.015) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { y: Math.min(0.94, box.y + 0.015) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { x: Math.max(0, box.x - 0.015) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { x: Math.min(0.88, box.x + 0.015) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      →
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { width: Math.max(0.18, box.width - 0.04) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => updateTextBox(box.id, { width: Math.min(0.82, box.width + 0.04) })}
                      className="rounded px-2 py-1 text-xs font-bold text-rose-key"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTextBox(box.id)}
                      className="ml-auto rounded px-2 py-1 text-xs font-bold text-rose-accent"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {textBoxes.length === 0 && (
            <div className="pointer-events-none absolute inset-x-8 top-8 rounded-xl border border-dashed border-rose-accent/45 bg-white/35 px-4 py-3 text-sm font-bold text-rose-key backdrop-blur-[1px]">
              입력할 위치를 클릭하세요.
            </div>
          )}
        </>
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full rounded-[18px] ${mode === 'ink' ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={startStroke}
        onPointerMove={moveStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      {mode === 'ink' && (
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-line bg-rose-card/90 p-2 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setTool('pen')}
            className={`rounded-lg px-2.5 py-1 text-sm font-bold ${tool === 'pen' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key'}`}
          >
            펜
          </button>
          <button
            type="button"
            onClick={() => setTool('eraser')}
            className={`rounded-lg px-2.5 py-1 text-sm font-bold ${tool === 'eraser' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key'}`}
          >
            지우개
          </button>
          {PEN_COLORS.map((penColor) => (
            <button
              key={penColor}
              type="button"
              onClick={() => {
                setColor(penColor)
                setTool('pen')
              }}
              className={`h-6 w-6 rounded-full border-2 ${color === penColor && tool === 'pen' ? 'border-rose-accent' : 'border-white'}`}
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
          <button type="button" onClick={undo} className="rounded-lg px-2.5 py-1 text-sm font-bold text-rose-key">
            취소
          </button>
          <button type="button" onClick={clear} className="rounded-lg px-2.5 py-1 text-sm font-bold text-rose-key">
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
      className={`relative mx-auto flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm transition ${
        active
          ? 'h-32 w-[92px] rounded-lg border-2 border-rose-accent shadow-lg shadow-rose-accent/20'
          : 'h-28 w-[58px] rounded-md border border-[#d6c4a7] opacity-85 shadow'
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
    <div className="relative w-full rounded-[18px] shadow-[0_18px_45px_rgba(44,39,34,0.16)]">
      <canvas ref={canvasRef} className="block w-full rounded-[18px] bg-white" />
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
  const [selectedId, setSelectedId] = useState(binderBooks[0]?.id ?? '')
  const [work, setWork] = useState<BinderWork | null>(null)
  const [document, setDocument] = useState<PdfDocument | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(binderBooks[0]?.pages ?? 1)
  const [loadingPdf, setLoadingPdf] = useState(true)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [previewDragging, setPreviewDragging] = useState(false)
  const previewDragRef = useRef<{ startX: number; startPage: number; lastPage: number } | null>(null)

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

  useEffect(() => {
    if (!user) return
    let alive = true
    const resetTimer = window.setTimeout(() => {
      if (alive) setWork(null)
    }, 0)
    getBinderWork(selected.id, user.id).then((next) => {
      if (alive) setWork(next)
    })
    return () => {
      alive = false
      window.clearTimeout(resetTimer)
    }
  }, [selected.id, user])

  useEffect(() => {
    let alive = true
    const resetTimer = window.setTimeout(() => {
      if (!alive) return
      setDocument(null)
      setPageNumber(1)
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

  const goPrev = () => setPageNumber((prev) => Math.max(1, prev - 1))
  const goNext = () => setPageNumber((prev) => Math.min(pageCount, prev + 1))
  const goToPage = (next: number) => setPageNumber(Math.max(1, Math.min(pageCount, next)))

  const startPreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (loadingPdf || !document) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    previewDragRef.current = { startX: event.clientX, startPage: pageNumber, lastPage: pageNumber }
    setPreviewDragging(true)
  }

  const movePreviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current
    if (!drag) return
    event.preventDefault()
    const pageDelta = Math.round((drag.startX - event.clientX) / 34)
    const nextPage = Math.max(1, Math.min(pageCount, drag.startPage + pageDelta))
    if (nextPage === drag.lastPage) return
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
      <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="w-20 shrink-0">
            {__APP_TARGET__ === 'all' && (
              <button
                type="button"
                onClick={() => window.history.back()}
                className="text-sm font-bold text-rose-key hover:text-rose-accent"
              >
                ← 이전
              </button>
            )}
          </div>
          <h1 className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">
            에다 SPL 바인더
          </h1>
          <div className="flex w-20 shrink-0 justify-end">
            {__APP_TARGET__ === 'all' && (
              <Link
                to="/"
                className="whitespace-nowrap rounded-lg border border-rose-line bg-rose-card px-3 py-2 text-sm font-bold text-rose-key shadow-sm"
              >
                노트
              </Link>
            )}
            {__APP_TARGET__ !== 'all' && (
              <button
                type="button"
                onClick={signOut}
                className="whitespace-nowrap rounded-lg border border-rose-line bg-rose-card px-3 py-2 text-sm font-bold text-rose-key shadow-sm"
              >
                로그아웃
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-[74px] xl:self-start">
          <section className="relative overflow-hidden rounded-[22px] border border-rose-line bg-rose-card p-5 shadow-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-rose-accent/80" />
            <div className="pointer-events-none absolute left-7 top-0 h-full border-l border-dashed border-rose-line" />
            <p className="pl-5 text-xs font-bold tracking-[0.32em] text-rose-key">EDA</p>
            <div className="mt-8 pl-5">
              <p className="font-serif text-4xl font-extrabold leading-tight">SPL</p>
              <p className="mt-1 font-serif text-2xl font-extrabold">바인더</p>
              <div className="mt-6 flex items-center gap-2">
                <span className="h-px flex-1 bg-rose-line" />
                <span className="text-xs font-bold text-rose-accent">I{selected.issue}</span>
              </div>
              <p className="mt-5 text-sm leading-6 text-rose-key">
                {selected.title}
                <br />
                입력 {completedPages}/{pageCount}쪽
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-[18px] border border-rose-line bg-rose-card shadow-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="font-serif text-base font-extrabold">권 선택</h2>
              <span className="text-xs font-bold text-rose-key">{binderBooks.length}권</span>
            </div>
            <div className="relative border-y border-rose-line bg-[#e7dcc8] px-3 pb-4 pt-3">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-[#9d7a54]" />
              <div className="flex min-h-[168px] items-end gap-1.5 overflow-x-auto pb-3">
              {binderBooks.map((book) => {
                const active = selected.id === book.id
                return (
                  <button
                    type="button"
                    key={book.id}
                    onClick={() => setSelectedId(book.id)}
                    className={`group relative flex shrink-0 flex-col justify-between overflow-hidden rounded-t-md border px-2 py-3 text-left shadow-sm transition ${
                      active
                        ? '-translate-y-2 border-rose-accent bg-rose-accent text-white shadow-xl shadow-rose-accent/25'
                        : 'border-[#b8a482] bg-[#f8f2e7] text-rose-ink hover:-translate-y-1 hover:border-rose-accent'
                    }`}
                    style={{
                      width: 44,
                      height: 142,
                    }}
                    aria-label={`${book.title} 선택`}
                  >
                    <span
                      className={`pointer-events-none absolute inset-y-0 left-1 w-px ${
                        active ? 'bg-white/35' : 'bg-white/70'
                      }`}
                    />
                    <span
                      className={`pointer-events-none absolute inset-y-0 right-1 w-px ${
                        active ? 'bg-black/10' : 'bg-black/5'
                      }`}
                    />
                    <span className={`text-[10px] font-black tracking-[0.18em] ${active ? 'text-white/75' : 'text-rose-key'}`}>
                      EDA
                    </span>
                    <span className="mx-auto flex flex-1 items-center justify-center">
                      <span className="[writing-mode:vertical-rl] font-serif text-sm font-extrabold tracking-[0.18em]">
                        SPL
                      </span>
                    </span>
                    <span className="text-center font-serif text-base font-extrabold">
                      {book.issue}
                    </span>
                    {active && (
                      <span className="absolute inset-x-1 bottom-1 h-1 rounded-full bg-white/45" />
                    )}
                  </button>
                )
              })}
              </div>
            </div>
            <div className="bg-[#d1b58d] px-4 py-2">
              <p className="truncate text-xs font-bold text-[#5f4930]">{selected.title}</p>
            </div>
          </section>

          <section className="rounded-[18px] border border-rose-line bg-rose-card p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="font-serif text-base font-extrabold">체크포인트</h2>
              <button
                type="button"
                onClick={addBookmark}
                className="rounded-lg bg-rose-chip px-2 py-1 text-xs font-bold text-rose-accent"
              >
                + 책갈피
              </button>
            </div>
            <div className="space-y-1.5">
              {checkpoints.map((checkpoint) => (
                <button
                  type="button"
                  key={checkpoint.id}
                  onClick={() => goToPage(checkpoint.page)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold transition ${
                    pageNumber === checkpoint.page
                      ? 'bg-rose-accent text-white'
                      : 'bg-white text-rose-key hover:text-rose-accent'
                  }`}
                >
                  <span className="truncate">{checkpoint.label}</span>
                  <span className="shrink-0 text-xs opacity-75">{checkpoint.page}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-rose-line pt-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-sm font-extrabold text-rose-ink">내 책갈피</h3>
                {currentPageBookmarked && <span className="text-xs font-bold text-rose-accent">현재 쪽</span>}
              </div>
              {bookmarks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-rose-line bg-white/60 px-3 py-3 text-sm leading-5 text-rose-key">
                  현재 페이지를 저장하려면 + 책갈피를 누르세요.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.id}
                      className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                        pageNumber === bookmark.page ? 'bg-rose-chip' : 'bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => goToPage(bookmark.page)}
                        className="min-w-0 flex-1 text-left text-sm font-bold text-rose-key hover:text-rose-accent"
                      >
                        <span className="block truncate">{bookmark.label}</span>
                        <span className="text-xs opacity-70">{bookmark.page}쪽</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBookmark(bookmark.id)}
                        className="rounded-md px-2 py-1 text-xs font-bold text-rose-key hover:bg-rose-bg hover:text-rose-accent"
                        aria-label={`${bookmark.label} 책갈피 삭제`}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-[18px] border border-rose-line bg-rose-card shadow-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="font-serif text-base font-extrabold">내용 미리보기</h2>
              <span className="text-xs font-bold text-rose-key">
                {pageNumber}/{pageCount}
              </span>
            </div>
            <div className="bg-[#efe4d1] px-3 pb-4 pt-3">
              <div
                className={`relative flex h-44 items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-[#d6c4a7] bg-[#eadcc4] px-2 py-4 shadow-inner ${
                  previewDragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                style={{ touchAction: 'none' }}
                onPointerDown={startPreviewDrag}
                onPointerMove={movePreviewDrag}
                onPointerUp={endPreviewDrag}
                onPointerCancel={endPreviewDrag}
                aria-label="내용 미리보기 드래그"
              >
                <div className="pointer-events-none absolute inset-x-3 bottom-5 h-3 rounded-full bg-[#b7986d]/45 blur-[1px]" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-white/18" />
                {loadingPdf || !document ? (
                  <div className="relative z-10 grid h-full place-items-center text-sm font-bold text-rose-key">
                    미리보기를 불러오는 중...
                  </div>
                ) : (
                  previewPages.map((previewPage) => {
                    const active = previewPage === pageNumber
                    return (
                      <div
                        key={previewPage}
                        className={`relative z-10 flex select-none items-center justify-center rounded-xl transition ${
                          active
                            ? 'mx-0.5 scale-105 bg-white/80 p-1.5 shadow-lg'
                            : 'bg-white/25 p-0.5 opacity-80'
                        }`}
                      >
                        <PdfThumbnail pdfDocument={document} pageNumber={previewPage} active={active} />
                      </div>
                    )
                  })
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={pageNumber === 1}
                  className="rounded-full border border-rose-line bg-white px-3 py-2 text-sm font-bold text-rose-key disabled:opacity-40"
                >
                  ←
                </button>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white shadow-inner">
                  <div
                    className="h-full rounded-full bg-rose-accent"
                    style={{ width: `${pageCount <= 1 ? 100 : ((pageNumber - 1) / (pageCount - 1)) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={pageNumber >= pageCount}
                  className="rounded-full border border-rose-line bg-white px-3 py-2 text-sm font-bold text-rose-key disabled:opacity-40"
                >
                  →
                </button>
              </div>
              <p className="mt-2 truncate text-center text-xs font-bold text-rose-key">
                {selected.title} · {pageNumber}쪽
              </p>
            </div>
          </section>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="rounded-[22px] border border-rose-line bg-rose-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.24em] text-rose-key">페이지 넘김</p>
                <h2 className="mt-1 font-serif text-2xl font-extrabold">{selected.title}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeToggle mode={pageInput.mode} onChange={setPageInputMode} />
                <span className="rounded-full bg-rose-chip px-3 py-1 text-xs font-bold text-rose-key">
                  {pageNumber}/{pageCount}
                </span>
              </div>
            </div>
          </div>

          <article
            className="relative rounded-[24px] border border-rose-line bg-[#e8ddca] p-3 shadow-sm"
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

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goPrev}
                disabled={pageNumber === 1}
                className="rounded-full border border-rose-line bg-rose-card px-4 py-2 text-sm font-bold text-rose-key shadow-sm disabled:opacity-40"
              >
                ← 이전
              </button>
              <input
                type="range"
                min={1}
                max={pageCount}
                step={1}
                value={pageNumber}
                onChange={(event) => goToPage(Number(event.target.value))}
                className="min-w-0 flex-1 accent-rose-accent"
                aria-label="페이지 이동"
              />
              <button
                type="button"
                onClick={goNext}
                disabled={pageNumber >= pageCount}
                className="rounded-full border border-rose-line bg-rose-card px-4 py-2 text-sm font-bold text-rose-key shadow-sm disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          </article>
        </section>

      </main>
    </div>
  )
}
