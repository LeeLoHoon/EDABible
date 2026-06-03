import { useState } from 'react'
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

const PEN_COLORS = ['#2f261d', '#6f4e2f', '#1f4f57', '#315b3b', '#8a5d19']

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

  const setStrokes = (strokes: Stroke[]) => onChange({ ...field, strokes })

  return (
    <div className="rounded-2xl border border-rose-line bg-rose-card p-2 shadow-md shadow-rose-ink/10">
      {field.mode === 'text' ? (
        <textarea
          className="w-full resize-y rounded-xl border border-rose-line bg-[#fffaf1] p-3 text-[17px] leading-relaxed text-rose-ink outline-none focus:border-rose-accent"
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
              className={`rounded-lg px-2.5 py-1 text-sm ${tool === 'pen' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key/65'}`}
            >
              ✏️ 펜
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`rounded-lg px-2.5 py-1 text-sm ${tool === 'eraser' ? 'bg-rose-chip text-rose-ink' : 'text-rose-key/65'}`}
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
                className={`h-6 w-6 rounded-full border-2 ${color === c && tool === 'pen' ? 'border-rose-accent' : 'border-rose-card'}`}
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
              className="rounded-lg px-2.5 py-1 text-sm text-rose-key/65 disabled:opacity-40"
            >
              ↩️ 취소
            </button>
            <button
              type="button"
              onClick={() => setStrokes([])}
              disabled={field.strokes.length === 0}
              className="rounded-lg px-2.5 py-1 text-sm text-rose-key/65 disabled:opacity-40"
            >
              전체 지우기
            </button>
          </div>

          <InkCanvas
            strokes={field.strokes}
            onChange={setStrokes}
            color={color}
            size={size}
            tool={tool}
            height={inkHeight}
          />
        </div>
      )}
    </div>
  )
}
