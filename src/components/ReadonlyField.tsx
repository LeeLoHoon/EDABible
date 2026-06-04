import { getStroke } from 'perfect-freehand'
import type { Field, Stroke } from '../types'

interface Props {
  field: Field
  minHeight?: number
}

const FREEHAND_OPTS = {
  thinning: 0.4,
  smoothing: 0.5,
  streamline: 0.3,
}

function strokePath(stroke: Stroke): string {
  const outline = getStroke(stroke.points, { ...FREEHAND_OPTS, size: stroke.size, last: true })
  if (outline.length < 2) {
    // 점/아주 짧은 획은 작은 원으로
    const p0 = stroke.points[0]
    if (!p0) return ''
    const r = Math.max(stroke.size / 2, 1)
    const [x, y] = p0
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`
  }
  return `${outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`
}

function bounds(strokes: Stroke[]) {
  let maxX = 0
  let maxY = 0
  for (const stroke of strokes) {
    for (const [x, y] of stroke.points) {
      maxX = Math.max(maxX, x + stroke.size)
      maxY = Math.max(maxY, y + stroke.size)
    }
  }
  return { width: Math.max(320, Math.ceil(maxX)), height: Math.max(120, Math.ceil(maxY)) }
}

export default function ReadonlyField({ field, minHeight = 96 }: Props) {
  const hasText = field.text.trim().length > 0
  const hasInk = field.strokes.length > 0

  if (hasText || (!hasInk && field.mode === 'text')) {
    return (
      <div
        className="min-h-24 whitespace-pre-wrap rounded-xl border border-rose-line bg-white px-4 py-3 text-[16px] leading-relaxed text-zinc-700"
        style={{ minHeight }}
      >
        {hasText ? field.text : <span className="text-zinc-300">작성된 내용이 없습니다.</span>}
      </div>
    )
  }

  const size = bounds(field.strokes)
  return (
    <div className="overflow-hidden rounded-xl border border-rose-line bg-white" style={{ minHeight }}>
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        width="100%"
        height={Math.max(minHeight, size.height)}
        preserveAspectRatio="xMinYMin meet"
        aria-label="손글씨 내용"
      >
        {field.strokes.map((stroke, index) => (
          <path key={index} d={strokePath(stroke)} fill={stroke.color} />
        ))}
      </svg>
    </div>
  )
}
