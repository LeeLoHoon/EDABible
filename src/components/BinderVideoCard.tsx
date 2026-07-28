import {
  YOUTUBE_ID_RE,
  type BinderVideoLesson,
} from '../../scripts/binder_videos'
import { t } from '../i18n/strings'

interface BinderVideoCardProps {
  lesson: BinderVideoLesson
  playing: boolean
  isOnline: boolean
  onPlay: () => void
}

export default function BinderVideoCard({
  lesson,
  playing,
  isOnline,
  onPlay,
}: BinderVideoCardProps) {
  if (!YOUTUBE_ID_RE.test(lesson.videoId)) return null

  const lessonDetails = (
    <div className="px-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold text-rose-accent-deep">
          {t('binderVideoLesson')(lesson.no)}
        </span>
        <span className="text-xs font-bold tabular-nums text-rose-key">
          {t('binderPage')(lesson.page)}
        </span>
      </div>
      <h4 className="mt-1 text-sm font-bold leading-5 text-rose-ink">
        {lesson.title}
      </h4>
    </div>
  )

  return (
    <article className="overflow-hidden rounded-xl border border-rose-line bg-white shadow-sm">
      {playing && isOnline ? (
        <>
          <div className="aspect-video w-full bg-black">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${lesson.videoId}?autoplay=1&playsinline=1&rel=0`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              title={lesson.title}
            />
          </div>
          {lessonDetails}
        </>
      ) : isOnline ? (
        <button
          type="button"
          className="group block w-full text-left"
          onClick={onPlay}
          aria-label={t('binderVideoPlayAria')(lesson.title)}
        >
          <div className="relative aspect-video w-full overflow-hidden bg-rose-chip">
            <img
              src={`https://i.ytimg.com/vi/${lesson.videoId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center bg-black/15 text-4xl text-white drop-shadow-lg"
            >
              ▶
            </span>
          </div>
          {lessonDetails}
        </button>
      ) : (
        <>
          <div className="flex aspect-video w-full items-center justify-center bg-rose-chip/70 p-4 text-center text-[13px] font-bold leading-5 text-rose-key">
            {t('binderVideoOffline')}
          </div>
          {lessonDetails}
        </>
      )}

      <a
        href={`https://youtu.be/${lesson.videoId}`}
        target="_blank"
        rel="noreferrer"
        className="mx-3 mb-3 mt-2 inline-flex text-[13px] font-bold text-rose-accent-deep underline decoration-rose-accent/50 underline-offset-2"
      >
        {t('binderVideoOpenYoutube')}
      </a>
    </article>
  )
}
