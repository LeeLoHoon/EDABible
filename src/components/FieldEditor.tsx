import { useRef, useState } from 'react'
import type { Field, Stroke } from '../types'
import InkCanvas, { type InkTool } from './InkCanvas'

interface Props {
  field: Field
  onChange: (field: Field) => void
  placeholder?: string
  /** 타이핑 textarea 줄 수 / 손글씨 캔버스 높이 비례 */
  rows?: number
  inkHeight?: number
}

const PEN_COLORS = ['#3f3f46', '#be185d', '#2563eb', '#059669', '#d97706']

export default function FieldEditor({
  field,
  onChange,
  placeholder,
  rows = 3,
  inkHeight = 220,
}: Props) {
  const [tool, setTool] = useState<InkTool>('pen')
  const [color, setColor] = useState(PEN_COLORS[0])
  const [size, setSize] = useState(6)
  // 손가락 입력 거부 시 잠깐 뜨는 안내
  const [showHint, setShowHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashHint = () => {
    setShowHint(true)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setShowHint(false), 1800)
  }

  const setMode = (mode: Field['mode']) => onChange({ ...field, mode })
  const setStrokes = (strokes: Stroke[]) => onChange({ ...field, strokes })

  return (
    <div className="rounded-2xl border border-rose-line bg-rose-card p-2 shadow-sm">
      {/* 모드 전환 */}
      <div className="mb-2 flex items-center gap-1">
        <ModeButton active={field.mode === 'text'} onClick={() => setMode('text')}>
          ⌨️ 타이핑
        </ModeButton>
        <ModeButton active={field.mode === 'ink'} onClick={() => setMode('ink')}>
          ✍️ 손글씨
        </ModeButton>
      </div>

      {field.mode === 'text' ? (
        <textarea
          className="w-full resize-y rounded-xl border border-rose-line bg-white p-3 text-[17px] leading-relaxed text-zinc-700 outline-none focus:border-rose-accent"
          rows={rows}
          placeholder={placeholder}
          value={field.text}
          onChange={(e) => onChange({ ...field, text: e.target.value })}
        />
      ) : (
        <div>
          {/* 손글씨 툴바 */}
          <div className="mb-2 flex flex-wrap items-center gap-2 touch-manipulation select-none">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`rounded-lg px-2.5 py-1 text-sm ${tool === 'pen' ? 'bg-rose-chip text-rose-ink' : 'text-zinc-500'}`}
            >
              ✏️ 펜
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`rounded-lg px-2.5 py-1 text-sm ${tool === 'eraser' ? 'bg-rose-chip text-rose-ink' : 'text-zinc-500'}`}
            >
              🧽 지우개
            </button>

            <span className="mx-1 h-4 w-px bg-rose-line" />

            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`색상 ${c}`}
                onClick={() => {
                  setColor(c)
                  setTool('pen')
                }}
                className={`h-6 w-6 rounded-full border-2 ${color === c && tool === 'pen' ? 'border-rose-accent' : 'border-white'}`}
                style={{ background: c }}
              />
            ))}

            <span className="mx-1 h-4 w-px bg-rose-line" />

            <input
              type="range"
              min={2}
              max={16}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-20 accent-rose-accent"
              aria-label="펜 굵기"
            />

            <button
              type="button"
              onClick={() => setStrokes(field.strokes.slice(0, -1))}
              disabled={field.strokes.length === 0}
              className="rounded-lg px-2.5 py-1 text-sm text-zinc-500 disabled:opacity-40"
            >
              ↩️ 취소
            </button>
            <button
              type="button"
              onClick={() => setStrokes([])}
              disabled={field.strokes.length === 0}
              className="rounded-lg px-2.5 py-1 text-sm text-zinc-500 disabled:opacity-40"
            >
              전체 지우기
            </button>
          </div>

          <div className="relative">
            <InkCanvas
              strokes={field.strokes}
              onChange={setStrokes}
              color={color}
              size={size}
              tool={tool}
              onTouchRejected={flashHint}
              height={inkHeight}
            />
            {showHint && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span className="rounded-full bg-rose-ink/85 px-3 py-1.5 text-sm font-medium text-white shadow">
                  ✍️ 손글씨는 펜으로만 쓸 수 있어요
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-medium transition ${
        active ? 'bg-rose-accent text-white' : 'bg-rose-chip text-rose-ink'
      }`}
    >
      {children}
    </button>
  )
}
