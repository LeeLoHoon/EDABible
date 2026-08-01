import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { videoStagesFor } from '../../scripts/binder_videos'
import type { BinderCheckpoint } from '../binderLibrary'
import { t } from '../i18n/strings'

interface BinderGuideSheetProps {
  setId: string
  setTitle: string
  checkpoints: readonly BinderCheckpoint[]
  currentPage: number
  pageCount: number
  /** 화면에 보이는 쪽 번호(숨긴 쪽 제외) — 없는 쪽이면 null */
  displayPage: (page: number) => number | null
  onJumpPage: (page: number) => void
  onClose: () => void
}

interface PageExample {
  key: string
  label: string
  page: number
}

export default function BinderGuideSheet({
  setId,
  setTitle,
  checkpoints,
  currentPage,
  pageCount,
  displayPage,
  onJumpPage,
  onClose,
}: BinderGuideSheetProps) {
  /** 안내에 쓰는 쪽 번호도 화면과 같은(숨긴 쪽을 뺀) 번호다 */
  const pageLabel = (page: number) => t('binderPage')(displayPage(page) ?? page)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const currentCheckpoint = [...checkpoints]
    .reverse()
    .find((checkpoint) => checkpoint.page <= currentPage)
  const videoLessons = (videoStagesFor(setId) ?? [])
    .flatMap((stage) => stage.lessons)
    .filter((lesson) => lesson.page >= 1 && lesson.page <= pageCount)
  const nearbyVideo = videoLessons.reduce<(typeof videoLessons)[number] | undefined>(
    (nearest, lesson) =>
      !nearest || Math.abs(lesson.page - currentPage) < Math.abs(nearest.page - currentPage)
        ? lesson
        : nearest,
    undefined,
  )

  const examples: PageExample[] = [
    {
      key: 'current',
      label: t('binderGuideCurrentExample'),
      page: currentPage,
    },
    ...(currentCheckpoint
      ? [
          {
            key: `checkpoint-${currentCheckpoint.id}`,
            label: currentCheckpoint.label,
            page: currentCheckpoint.page,
          },
        ]
      : []),
    ...(nearbyVideo
      ? [
          {
            key: `video-${nearbyVideo.videoId}`,
            label: t('binderGuideVideoExample')(nearbyVideo.title),
            page: nearbyVideo.page,
          },
        ]
      : []),
  ].filter(
    (example, index, list) => list.findIndex((candidate) => candidate.page === example.page) === index,
  )

  const workflowRows = [
    {
      order: 1,
      what: t('binderGuideChooseSet'),
      where: setTitle,
    },
    {
      order: 2,
      what: t('binderGuideChooseCheckpoint'),
      where: currentCheckpoint
        ? `${currentCheckpoint.label} · ${pageLabel(currentCheckpoint.page)}`
        : pageLabel(currentPage),
    },
    ...(nearbyVideo
      ? [
          {
            order: 3,
            what: t('binderGuideWatchVideo'),
            where: `${nearbyVideo.title} · ${pageLabel(nearbyVideo.page)}`,
          },
        ]
      : []),
    {
      order: nearbyVideo ? 4 : 3,
      what: t('binderGuideReadWrite'),
      where: pageLabel(currentPage),
    },
    {
      order: nearbyVideo ? 5 : 4,
      what: t('binderGuideShare'),
      where: t('binderShare'),
    },
  ]

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleDialogKey)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleDialogKey)
      previousFocusRef.current?.focus()
    }
  }, [onClose])

  const jump = (page: number) => {
    onJumpPage(page)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-rose-ink/45 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-rose-line bg-rose-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="binder-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rose-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] font-black tracking-[0.24em] text-rose-key/70">EDA · SPL</p>
            <h2 id="binder-guide-title" className="mt-0.5 font-serif text-lg font-extrabold text-rose-ink">
              {t('binderGuideTitle')}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-rose-key/70 transition hover:bg-rose-chip/60 hover:text-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent"
            aria-label={t('binderClose')}
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="rounded-xl bg-rose-chip/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-ink">
            {t('binderGuideIntro')}
          </p>

          <section aria-labelledby="binder-guide-workflow">
            <h3 id="binder-guide-workflow" className="font-serif text-base font-extrabold text-rose-ink">
              {t('binderGuideWorkflow')}
            </h3>
            <div className="mt-2 overflow-hidden rounded-xl border border-rose-line bg-white">
              <table className="w-full table-fixed border-collapse text-left text-[13px] leading-5">
                <thead className="bg-rose-chip/70 text-rose-key">
                  <tr>
                    <th scope="col" className="w-12 px-2.5 py-2 font-black">{t('binderGuideOrder')}</th>
                    <th scope="col" className="w-[38%] px-2.5 py-2 font-black">{t('binderGuideWhat')}</th>
                    <th scope="col" className="px-2.5 py-2 font-black">{t('binderGuideWhere')}</th>
                  </tr>
                </thead>
                <tbody>
                  {workflowRows.map((row) => (
                    <tr key={`${row.order}-${row.what}`} className="border-t border-rose-line/70 align-top">
                      <td className="px-2.5 py-2 font-black tabular-nums text-rose-accent-deep">{row.order}</td>
                      <td className="break-words px-2.5 py-2 font-bold text-rose-ink">{row.what}</td>
                      <td className="break-words px-2.5 py-2 text-rose-key" title={row.where}>{row.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="binder-guide-share">
            <h3 id="binder-guide-share" className="font-serif text-base font-extrabold text-rose-ink">
              {t('binderGuideShareTitle')}
            </h3>
            <p className="mt-1 text-[13px] leading-5 text-rose-key">{t('binderGuideShareHint')}</p>
          </section>

          <section aria-labelledby="binder-guide-examples">
            <h3 id="binder-guide-examples" className="font-serif text-base font-extrabold text-rose-ink">
              {t('binderGuideExamples')}
            </h3>
            <p className="mt-1 text-[13px] leading-5 text-rose-key">{t('binderGuideExamplesHint')}</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {examples.map((example) => (
                <button
                  type="button"
                  key={example.key}
                  onClick={() => jump(example.page)}
                  title={`${example.label} · ${pageLabel(example.page)}`}
                  className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-xl border border-rose-line bg-white px-3 py-2 text-left transition hover:border-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent"
                >
                  <span className="min-w-0 truncate text-sm font-bold text-rose-ink">{example.label}</span>
                  <span className="shrink-0 rounded-full bg-rose-chip px-2 py-1 text-xs font-black tabular-nums text-rose-accent-deep">
                    {pageLabel(example.page)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}
