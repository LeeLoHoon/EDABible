import type { FieldMode } from '../types'

interface Props {
  mode: FieldMode
  onChange: (mode: FieldMode) => void
}

/** 섹션 전체의 입력 방식(타이핑/손글씨)을 한 번에 전환하는 토글 */
export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="inline-flex select-none rounded-full border border-rose-line bg-rose-chip p-0.5 shadow-inner shadow-rose-ink/10">
      <button
        type="button"
        onClick={() => onChange('text')}
        className={`rounded-full px-3 py-1 text-sm font-medium transition ${
          mode === 'text' ? 'bg-rose-accent text-[#fff8ed]' : 'text-rose-ink'
        }`}
      >
        ⌨️ 타이핑
      </button>
      <button
        type="button"
        onClick={() => onChange('ink')}
        className={`rounded-full px-3 py-1 text-sm font-medium transition ${
          mode === 'ink' ? 'bg-rose-accent text-[#fff8ed]' : 'text-rose-ink'
        }`}
      >
        ✍️ 손글씨
      </button>
    </div>
  )
}
