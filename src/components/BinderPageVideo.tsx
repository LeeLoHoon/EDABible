import { useEffect, useState } from 'react'
import type { BinderVideoLesson, BinderVideoStage } from '../../scripts/binder_videos'
import { t } from '../i18n/strings'
import BinderVideoCard from './BinderVideoCard'

interface BinderPageVideoProps {
  stage: BinderVideoStage
  lesson: BinderVideoLesson
}

/**
 * 느낀 점을 적는 쪽 위에 얹는 요약 영상이다. 예전에는 영상만 있는 별도 화면을 지나야
 * 쪽에 닿았지만, 영상을 보면서 바로 적을 수 있도록 같은 화면에 둔다. 쪽을 넓게 쓰고
 * 싶으면 접을 수 있고, 접은 상태는 다음 영상 쪽으로 넘어가도 이어진다.
 */
export default function BinderPageVideo({ stage, lesson }: BinderPageVideoProps) {
  const [open, setOpen] = useState(true)
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
    <section className="mb-2.5 overflow-hidden rounded-2xl border border-rose-line bg-rose-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="shrink-0 rounded-full bg-rose-chip px-2.5 py-1 text-[11px] font-extrabold text-rose-accent-deep">
          🎬 {t('binderVideoStage')(stage.stage)} · {t('binderVideoLesson')(lesson.no)}
        </span>
        <span className="min-w-0 flex-1 break-keep text-[13px] font-bold leading-5 text-rose-ink">
          {lesson.title}
        </span>
        <span aria-hidden className="shrink-0 text-xs font-bold text-rose-key">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <BinderVideoCard
            lesson={lesson}
            playing={playing}
            isOnline={isOnline}
            onPlay={() => setPlaying(true)}
          />
          <p className="mt-2 text-[13px] font-bold leading-5 text-rose-key">
            {t('binderVideoInlineHint')}
          </p>
        </div>
      )}
    </section>
  )
}
