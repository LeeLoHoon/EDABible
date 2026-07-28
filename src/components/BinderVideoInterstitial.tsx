import { useEffect, useState } from 'react'
import type {
  BinderVideoLesson,
  BinderVideoStage,
} from '../../scripts/binder_videos'
import { t } from '../i18n/strings'
import BinderVideoCard from './BinderVideoCard'

interface BinderVideoInterstitialProps {
  stage: BinderVideoStage
  lesson: BinderVideoLesson
  onContinue: () => void
}

export default function BinderVideoInterstitial({
  stage,
  lesson,
  onContinue,
}: BinderVideoInterstitialProps) {
  const [playing, setPlaying] = useState(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false)

  useEffect(() => {
    const updateOnlineState = () => {
      const online = navigator.onLine !== false
      setIsOnline(online)
      if (!online) setPlaying(false)
    }

    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  return (
    <div className="h-full overflow-y-auto rounded-2xl bg-rose-card">
      <div className="flex min-h-full items-center justify-center px-4 py-6 sm:px-12 sm:py-8">
        <div className="w-full max-w-xl">
          <div className="text-center">
            <span className="inline-flex rounded-full bg-rose-chip px-3 py-1 text-xs font-extrabold text-rose-accent-deep">
              {t('binderVideoStage')(stage.stage)} · {t('binderVideoLesson')(lesson.no)}
            </span>
            <h3 className="mt-3 break-keep font-serif text-xl font-extrabold leading-snug text-rose-ink">
              {lesson.title}
            </h3>
          </div>

          <div className="mx-auto mt-5 max-w-md">
            <BinderVideoCard
              lesson={lesson}
              playing={playing}
              isOnline={isOnline}
              onPlay={() => setPlaying(true)}
            />
          </div>

          <p className="mt-5 text-center text-sm font-bold leading-6 text-rose-key">
            {t('binderVideoInterstitialHint')}
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="mx-auto mt-4 flex min-w-36 items-center justify-center rounded-full bg-rose-accent-deep px-6 py-3 text-[15px] font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98]"
            aria-label={t('binderVideoContinueAria')}
          >
            {t('binderVideoContinue')} →
          </button>
        </div>
      </div>
    </div>
  )
}
