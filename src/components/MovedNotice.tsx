import { useState } from 'react'
import { t } from '../i18n/strings'

const DISMISS_KEY = 'edabible:movedNotice:dismissed'
const UNIFIED_ORIGIN = 'https://eda-bible.vercel.app'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function MovedNotice({ path }: { path: string }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 저장 실패해도 세션 내에서는 닫힌 상태를 유지한다
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-rose-accent-deep px-3 py-2 text-[13px] font-bold text-white">
      <span className="min-w-0 flex-1 leading-5">{t('movedNoticeText')}</span>
      <a
        href={`${UNIFIED_ORIGIN}/#${path}`}
        className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-extrabold text-rose-accent-deep"
      >
        {t('movedNoticeOpen')}
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('movedNoticeDismiss')}
        className="shrink-0 rounded-full px-1.5 text-white/80 transition hover:text-white"
      >
        ✕
      </button>
    </div>
  )
}
