import { useEffect, useRef, useState } from 'react'
import {
  currentVideoStage,
  videoStagesFor,
  YOUTUBE_ID_RE,
} from '../../scripts/binder_videos'
import { t } from '../i18n/strings'
import BinderVideoCard from './BinderVideoCard'

interface BinderVideoSheetProps {
  setId: string
  currentPage: number
  onClose: () => void
}

export default function BinderVideoSheet({
  setId,
  currentPage,
  onClose,
}: BinderVideoSheetProps) {
  const stages = videoStagesFor(setId) ?? []
  const [selectedStageId, setSelectedStageId] = useState(
    () => currentVideoStage(setId, currentPage)?.stage ?? stages[0]?.stage ?? '',
  )
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false)
  const selectedStageChipRef = useRef<HTMLButtonElement>(null)
  const selectedStage = stages.find((stage) => stage.stage === selectedStageId) ?? stages[0]
  const lessons = selectedStage?.lessons.filter((lesson) => YOUTUBE_ID_RE.test(lesson.videoId)) ?? []

  useEffect(() => {
    selectedStageChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [])

  useEffect(() => {
    const updateOnlineState = () => {
      const online = navigator.onLine !== false
      setIsOnline(online)
      if (!online) setPlayingVideoId(null)
    }

    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-rose-ink/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        className="flex max-h-[85vh] min-w-0 w-full max-w-lg flex-col rounded-2xl border border-rose-line bg-rose-card p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="binder-video-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h3 id="binder-video-modal-title" className="font-serif text-lg font-extrabold">
            {t('binderVideoModalTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-rose-key transition hover:bg-rose-chip"
            aria-label={t('binderClose')}
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-2">
          {stages.map((stage) => {
            const selected = stage.stage === selectedStage?.stage
            return (
              <button
                type="button"
                key={stage.stage}
                ref={selected ? selectedStageChipRef : undefined}
                onClick={() => {
                  setSelectedStageId(stage.stage)
                  setPlayingVideoId(null)
                }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-bold transition ${
                  selected
                    ? 'border-rose-accent-deep bg-rose-accent-deep text-white'
                    : 'border-rose-line bg-white text-rose-key hover:border-rose-accent'
                }`}
                aria-pressed={selected}
              >
                {t('binderVideoStage')(stage.stage)}
              </button>
            )
          })}
        </div>

        <div className="mt-1 grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto rounded-xl bg-rose-chip/40 p-2 sm:grid-cols-2">
          {lessons.map((lesson) => (
            <BinderVideoCard
              key={lesson.videoId}
              lesson={lesson}
              playing={playingVideoId === lesson.videoId}
              isOnline={isOnline}
              onPlay={() => setPlayingVideoId(lesson.videoId)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
