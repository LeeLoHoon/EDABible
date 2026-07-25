import type { FieldMode } from '../types'
import { t } from '../i18n/strings'

interface Props {
  mode: FieldMode
  onChange: (mode: FieldMode) => void
}

/** 섹션 전체의 입력 방식(타이핑/손글씨)을 한 번에 전환하는 토글 */
export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="inline-flex select-none rounded-full bg-rose-chip p-0.5">
      <button
        type="button"
        onClick={() => onChange('text')}
        className={`rounded-full px-3 py-1 text-sm font-medium transition ${
          mode === 'text' ? 'bg-rose-accent-deep text-white' : 'text-rose-ink'
        }`}
      >
        {t('modeTyping')}
      </button>
      <button
        type="button"
        onClick={() => onChange('ink')}
        className={`rounded-full px-3 py-1 text-sm font-medium transition ${
          mode === 'ink' ? 'bg-rose-accent-deep text-white' : 'text-rose-ink'
        }`}
      >
        {t('modeInk')}
      </button>
    </div>
  )
}
