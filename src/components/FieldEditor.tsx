import { useMemo, useState } from 'react'
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
  const [size, setSize] = useState(3)
  // 사용자가 '공간 늘리기'로 추가한 높이(px)
  const [extra, setExtra] = useState(0)

  const setStrokes = (strokes: Stroke[]) => onChange({ ...field, strokes })

  // 기존 필기가 잘리지 않도록 내용의 최하단을 계산 → 캔버스 높이 자동 확보
  const contentBottom = useMemo(() => {
    let maxY = 0
    for (const s of field.strokes) {
      for (const [, y] of s.points) if (y + s.size > maxY) maxY = y + s.size
    }
    return maxY
  }, [field.strokes])

  // 높이는 160px 계단으로만 늘린다 — 아래쪽에 쓸 때 획마다 높이가 1px씩 변하면
  // 캔버스가 매 획 재할당·전체 재렌더되어 다음 획 입력이 밀린다.
  const autoGrown = Math.ceil((contentBottom + 80) / 160) * 160
  const canvasHeight = Math.max(inkHeight + extra, autoGrown)

  return (
    <div className="rounded-2xl border border-rose-line bg-rose-card p-2 shadow-sm">
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
              min={1}
              max={14}
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

          <InkCanvas
            strokes={field.strokes}
            onChange={setStrokes}
            color={color}
            size={size}
            tool={tool}
            height={canvasHeight}
          />

          {/* 칸이 부족할 때 아래로 공간을 더 확보 */}
          <button
            type="button"
            onClick={() => setExtra((e) => e + 240)}
            className="mt-2 w-full rounded-xl border border-dashed border-rose-line py-2.5 text-sm font-medium text-rose-key active:bg-rose-chip/50"
          >
            + 공간 늘리기
          </button>
        </div>
      )}
    </div>
  )
}
