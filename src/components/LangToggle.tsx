import { useState } from 'react'
import { getLang, setStoredLang, type Lang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { flushPendingSaves } from '../saveFlush'

interface Props {
  className?: string
}

export default function LangToggle({ className = '' }: Props) {
  const current = getLang()
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState(false)

  const select = async (next: Lang) => {
    if (next === current || switching) return
    setSwitching(true)
    setFailed(false)
    try {
      await flushPendingSaves()
    } catch (error) {
      console.warn('Language switch was cancelled because pending saves failed.', error)
      setSwitching(false)
      setFailed(true)
      return
    }
    setStoredLang(next)
    window.location.reload()
  }

  return (
    <div className={className}>
      <div className="inline-flex select-none rounded-full bg-rose-chip p-0.5">
        {(['ko', 'en'] as const).map((lang) => (
          <button
            key={lang}
            type="button"
            disabled={switching}
            onClick={() => void select(lang)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold transition disabled:opacity-60 ${
              current === lang ? 'bg-rose-accent-deep text-white' : 'text-rose-key'
            }`}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>
      {failed && (
        <p aria-live="polite" className="mt-1 max-w-48 text-right text-[11px] font-bold text-rose-accent">
          {t('langSwitchSaveFailed')}
        </p>
      )}
    </div>
  )
}
