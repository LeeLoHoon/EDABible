/* 묵상 보관함 — 지난 주·월·년의 묵상을 계정 기준으로 모아 본다.

   목록의 원천은 서버(list_my_sermon_notes)다. 로컬 캐시가 아니라 계정을 보므로
   기기를 바꿔도 지난 기록이 그대로 따라온다. 로그인 없이는 보관 자체가 성립하지 않아
   이 화면은 로그인 안내로 대체한다. */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../authState'
import BackButton from '../components/BackButton'
import LangToggle from '../components/LangToggle'
import { listMySermonNotes, listSermons, type Sermon, type SermonNoteSummary, type SermonService } from '../db'
import {
  buildArchiveRows,
  countWrittenWeeks,
  groupByYearMonth,
  type ArchiveRow,
} from '../sermonArchive'
import { SERMON_LIST_PATH, localizedSermonPassageLabel, localizedText } from '../sermon'
import { formatEntryDateDot } from '../i18n/format'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'

function serviceLabel(service: SermonService): string {
  return service === 'morning' ? t('sermonServiceMorning') : t('sermonServiceAfternoon')
}

export default function SermonArchivePage() {
  const lang = getLang()
  const navigate = useNavigate()
  const { user, signInWithGoogle } = useAuth()
  const userId = user?.id
  const [notes, setNotes] = useState<SermonNoteSummary[]>([])
  const [sermons, setSermons] = useState<Sermon[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // 렌더 중 new Date()를 부르지 않아야 react-hooks/purity를 지킨다 (SermonPage와 같은 패턴)
  const [thisYear] = useState(() => String(new Date().getFullYear()))
  // 올해만 펼친 채로 시작한다 — 지난 연도는 접어 두어야 목록이 한눈에 들어온다
  const [openYears, setOpenYears] = useState<ReadonlySet<string>>(
    () => new Set([String(new Date().getFullYear())]),
  )

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setLoadFailed(false)
    Promise.all([listMySermonNotes(), listSermons()])
      .then(([noteList, sermonList]) => {
        if (!alive) return
        setNotes(noteList)
        setSermons(sermonList)
      })
      .catch((error) => {
        console.warn('Sermon archive load failed.', error)
        if (alive) setLoadFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId])

  const rows = useMemo(
    () => buildArchiveRows(notes, sermons, showAll),
    [notes, sermons, showAll],
  )
  const grouped = useMemo(() => groupByYearMonth(rows), [rows])
  const writtenWeeksThisYear = useMemo(
    () => countWrittenWeeks(notes, thisYear),
    [notes, thisYear],
  )

  const toggleYear = (year: string) => {
    setOpenYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const header = (
    <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <BackButton to={SERMON_LIST_PATH} label={t('navBackList')} />
        <h1 className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">
          {t('sermonArchiveTitle')}
        </h1>
        <div className="shrink-0">
          <LangToggle />
        </div>
      </div>
    </header>
  )

  if (!userId) {
    return (
      <div className="min-h-full bg-rose-bg text-rose-ink">
        {header}
        <main className="mx-auto max-w-3xl px-4 py-10">
          <section className="rounded-2xl border border-dashed border-rose-accent/50 bg-rose-card px-4 py-8 text-center shadow-sm">
            <h2 className="font-serif text-base font-extrabold text-rose-ink">
              {t('sermonArchiveSignInTitle')}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-rose-key">
              {t('sermonSignInBody')}
            </p>
            <button
              type="button"
              onClick={() => {
                void signInWithGoogle().catch((error) => {
                  console.warn('Google sign-in failed.', error)
                })
              }}
              className="mt-4 min-h-11 rounded-full bg-rose-accent-deep px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98]"
            >
              {t('sermonSignInAction')}
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-rose-bg text-rose-ink">
      {header}

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-rose-chip px-3 py-1 text-xs font-black text-rose-accent">
            {t('sermonArchiveStat')(thisYear, writtenWeeksThisYear)}
          </span>
          <div className="inline-flex select-none rounded-full bg-rose-chip p-0.5">
            {[false, true].map((all) => (
              <button
                key={String(all)}
                type="button"
                onClick={() => setShowAll(all)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  showAll === all ? 'bg-rose-accent-deep text-white' : 'text-rose-key'
                }`}
              >
                {all ? t('sermonArchiveFilterAll') : t('sermonArchiveFilterMine')}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="py-12 text-center text-rose-key/70">{t('sermonArchiveLoading')}</p>
        ) : loadFailed ? (
          <p className="py-12 text-center text-rose-key/70">{t('sermonArchiveLoadError')}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-line bg-rose-card/60 py-16 text-center">
            <p className="font-serif text-lg font-bold text-rose-key">{t('sermonArchiveEmpty')}</p>
            <p className="mt-1 text-sm text-rose-key/70">{t('sermonArchiveEmptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {[...grouped.keys()]
              .sort()
              .reverse()
              .map((year) => {
                const open = openYears.has(year)
                const byMonth = grouped.get(year) ?? new Map<string, ArchiveRow[]>()
                const yearCount = [...byMonth.values()].reduce((sum, list) => sum + list.length, 0)

                return (
                  <section key={year} className="space-y-3">
                    <button
                      type="button"
                      onClick={() => toggleYear(year)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <h2 className="font-serif text-xl font-extrabold text-rose-ink">
                        {t('sermonArchiveYear')(year)}
                      </h2>
                      <span className="text-xs font-bold text-rose-key/70">
                        {t('sermonArchiveCount')(yearCount)}
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-rose-line" />
                      <span aria-hidden className="text-sm text-rose-key/60">
                        {open ? '▴' : '▾'}
                      </span>
                    </button>

                    {open &&
                      [...byMonth.keys()]
                        .sort()
                        .reverse()
                        .map((month) => (
                          <div key={month} className="space-y-2">
                            <p className="text-sm font-bold text-rose-key/80">
                              {t('sermonArchiveMonth')(month)}
                            </p>
                            <div className="space-y-2">
                              {(byMonth.get(month) ?? []).map((row) => (
                                <ArchiveCard
                                  key={`${row.sermonId}-${row.service}`}
                                  row={row}
                                  lang={lang}
                                  onOpen={() => navigate(`/sermon/${row.sermonId}`)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                  </section>
                )
              })}
          </div>
        )}
      </main>
    </div>
  )
}

function ArchiveCard({
  row,
  lang,
  onOpen,
}: {
  row: ArchiveRow
  lang: ReturnType<typeof getLang>
  onOpen: () => void
}) {
  const title = localizedText(row.title, row.titleEn, lang)
  const note = row.note

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-rose-line bg-rose-card p-3.5 text-left shadow-sm transition active:scale-[0.995]"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-bold text-rose-key">{formatEntryDateDot(row.preachedOn)}</span>
        <span className="rounded-full bg-rose-chip px-2 py-0.5 text-[11px] font-black text-rose-accent">
          {serviceLabel(row.service)}
        </span>
      </div>
      <h3 className="mt-1 font-serif text-base font-extrabold text-rose-ink">{title}</h3>
      {row.passages.length > 0 && (
        <p className="mt-0.5 text-sm font-medium text-rose-key">
          {row.passages.map((passage) => localizedSermonPassageLabel(passage, lang)).join(', ')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-rose-key/80">
        {note ? (
          <>
            <span className="font-bold text-rose-accent">
              {t('sermonArchiveUpdated')(formatEntryDateDot(isoDateKey(note.updatedAt)))}
            </span>
            {note.highlightCount > 0 && <span>{t('sermonArchiveHighlights')(note.highlightCount)}</span>}
            {note.answeredPoints > 0 && <span>{t('sermonArchivePoints')(note.answeredPoints)}</span>}
            {note.writtenFields > 0 && <span>{t('sermonArchiveWritten')(note.writtenFields)}</span>}
          </>
        ) : (
          <span className="text-rose-key/60">{t('sermonArchiveNoNote')}</span>
        )}
      </div>
    </button>
  )
}

/** timestamp → 'YYYY-MM-DD' (로컬) — formatEntryDateDot이 날짜 키를 받기 때문 */
function isoDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
