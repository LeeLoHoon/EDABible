import { useState } from 'react'
import { getLang, setStoredLang, type Lang } from '../i18n/lang'
import { flushPendingSaves } from '../saveFlush'

interface Props {
  className?: string
}

export default function LangToggle({ className = '' }: Props) {
  const current = getLang()
  const [switching, setSwitching] = useState(false)

  const select = async (next: Lang) => {
    if (next === current || switching) return
    setSwitching(true)
    setStoredLang(next)
    await flushPendingSaves()
    window.location.reload()
  }

  return (
    <div className={`inline-flex select-none rounded-full bg-rose-chip p-0.5 ${className}`}>
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
  )
}
