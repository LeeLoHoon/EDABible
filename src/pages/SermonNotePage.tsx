import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../authState'
import FieldEditor from '../components/FieldEditor'
import LangToggle from '../components/LangToggle'
import ModeToggle from '../components/ModeToggle'
import PassageText from '../components/PassageText'
import VoiceRecorder from '../components/VoiceRecorder'
import {
  getSermonNote,
  listSermons,
  putSermonNote,
  type Sermon,
  type SermonNote,
} from '../db'
import { loadSermonPassages, sermonPassagesLabel, type SermonPassageText } from '../sermon'
import { isWithinMeditationPeriod, meditationPeriod } from '../sermonWeek'
import { applyRanges, HIGHLIGHT_COLORS, removeRange } from '../highlights'
import { BIBLE_VERSIONS, getBibleVersion, setBibleVersion, type BibleVersion } from '../bibleVersion'
import { getLang } from '../i18n/lang'
import type { Field, FieldMode, HighlightColor, VerseHighlight } from '../types'
import { formatEntryDateDot } from '../i18n/format'
import { t } from '../i18n/strings'

const SAVE_DEBOUNCE_MS = 800

/** memo된 PassageText가 헛되이 재렌더되지 않도록 빈 목록은 안정 참조로 넘긴다 */
const EMPTY_RANGES: VerseHighlight[] = []

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function statusLabel(status: SaveStatus): string {
  if (status === 'saving') return t('sermonSaving')
  if (status === 'saved') return t('sermonSaved')
  if (status === 'error') return t('sermonSaveErrorInline')
  return ''
}

export default function SermonNotePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const userId = user?.id

  const [sermon, setSermon] = useState<Sermon | null>(null)
  const [note, setNote] = useState<SermonNote | null>(null)
  const [passages, setPassages] = useState<SermonPassageText | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<FieldMode>('text')
  const [penColor, setPenColor] = useState<HighlightColor | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [bibleVersion, setBibleVersionState] = useState<BibleVersion>(() => getBibleVersion())
  // 영어 모드는 역본 축이 없다(항상 영어 The Message) — 형광펜도 기본 저장소를 쓴다
  const effectiveVersion: BibleVersion = getLang() === 'en' ? 'msg' : bibleVersion

  const saveTimerRef = useRef<number | null>(null)
  const pendingNoteRef = useRef<SermonNote | null>(null)
  // 언마운트 시 최신 userId로 즉시 저장하기 위해 ref로 보존한다 — 유실 방지
  const userIdRef = useRef(userId)

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  useEffect(() => {
    if (!id) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setNotFound(false)
    setSermon(null)
    setNote(null)
    setPassages(null)

    ;(async () => {
      const list = await listSermons()
      if (!alive) return
      const target = list.find((s) => s.id === id)
      if (!target) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const loadedNote = await getSermonNote(target.id, target.points.length, userId)
      if (!alive) return
      setSermon(target)
      setNote(loadedNote)
      // 이전에 저장해둔 입력 방식으로 시작해야 손글씨 획이 갑자기 텍스트 영역 뒤로 사라지지 않는다
      setMode(loadedNote.freeNote.mode)
      setLoading(false)
    })().catch(() => {
      if (alive) {
        setNotFound(true)
        setLoading(false)
      }
    })

    return () => {
      alive = false
    }
  }, [id, userId])

  useEffect(() => {
    if (!sermon) return
    let alive = true
    loadSermonPassages(sermon.passages)
      .then((result) => {
        if (alive) setPassages(result)
      })
      .catch((error) => {
        // null로 두면 '불러오는 중' 문구에 영영 갇힌다. 빈 본문으로 떨어뜨려 안내를 띄운다.
        console.warn('Sermon passage load failed.', error)
        if (alive) {
          setPassages({ ref: sermonPassagesLabel(sermon.passages), chunks: [], startChapter: 1 })
        }
      })
    return () => {
      alive = false
    }
    // bibleVersion이 바뀌면 같은 본문을 새 역본으로 다시 불러온다(loadBook이 저장된 역본을 읽는다)
  }, [sermon, bibleVersion])

  const scheduleSave = useCallback((next: SermonNote) => {
    pendingNoteRef.current = next
    setSaveStatus('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const toSave = pendingNoteRef.current
      if (!toSave) {
        setSaveStatus('idle')
        return
      }
      putSermonNote(toSave, userIdRef.current)
        .then(() => {
          // 저장 도중 새 편집이 들어왔으면 상태를 덮어쓰지 않는다 — 다음 debounce가 계속 처리한다
          if (pendingNoteRef.current === toSave) {
            pendingNoteRef.current = null
            setSaveStatus('saved')
          }
        })
        .catch(() => {
          if (pendingNoteRef.current === toSave) setSaveStatus('error')
        })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    // 화면을 옮기거나 앱이 닫혀도 debounce 중이던 마지막 편집은 잃지 않고 흘려보낸다
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const pending = pendingNoteRef.current
      if (pending) {
        void putSermonNote(pending, userIdRef.current).catch((error) => {
          console.warn('Sermon note flush on unmount failed.', error)
        })
        pendingNoteRef.current = null
      }
    }
  }, [])

  const updateNote = useCallback(
    (updater: (prev: SermonNote) => SermonNote) => {
      setNote((prev) => {
        if (!prev) return prev
        const next = updater(prev)
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const updatePointAnswer = (index: number, field: Field) => {
    updateNote((prev) => ({
      ...prev,
      pointAnswers: prev.pointAnswers.map((existing, i) => (i === index ? field : existing)),
    }))
  }
  const updateFreeNote = (field: Field) => {
    updateNote((prev) => ({ ...prev, freeNote: field }))
  }
  const applyHighlights = useCallback(
    (adds: VerseHighlight[]) =>
      updateNote((prev) =>
        effectiveVersion === 'msg'
          ? { ...prev, highlightRanges: applyRanges(prev.highlightRanges, adds) }
          : {
              ...prev,
              highlightVersions: {
                ...prev.highlightVersions,
                [effectiveVersion]: applyRanges(prev.highlightVersions[effectiveVersion] ?? [], adds),
              },
            },
      ),
    [updateNote, effectiveVersion],
  )
  const removeHighlight = useCallback(
    (key: string, start: number, end: number) =>
      updateNote((prev) =>
        effectiveVersion === 'msg'
          ? { ...prev, highlightRanges: removeRange(prev.highlightRanges, key, start, end) }
          : {
              ...prev,
              highlightVersions: {
                ...prev.highlightVersions,
                [effectiveVersion]: removeRange(
                  prev.highlightVersions[effectiveVersion] ?? [],
                  key,
                  start,
                  end,
                ),
              },
            },
      ),
    [updateNote, effectiveVersion],
  )
  const selectBibleVersion = (next: BibleVersion) => {
    if (next === bibleVersion) return
    setBibleVersion(next)
    setBibleVersionState(next)
  }

  const setModeAll = (nextMode: FieldMode) => {
    setMode(nextMode)
    updateNote((prev) => ({
      ...prev,
      pointAnswers: prev.pointAnswers.map((field) => ({ ...field, mode: nextMode })),
      freeNote: { ...prev.freeNote, mode: nextMode },
    }))
  }

  if (loading) {
    return <div className="p-8 text-center text-rose-key/70">{t('sermonNoteLoading')}</div>
  }
  if (notFound || !sermon || !note) {
    return (
      <div className="p-8 text-center text-rose-key">
        {t('sermonNotFound')}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="ml-2 text-rose-accent underline"
        >
          {t('sermonBack')}
        </button>
      </div>
    )
  }

  const period = meditationPeriod(sermon.preachedOn)
  const thisWeek = isWithinMeditationPeriod(sermon.preachedOn, new Date())
  const passageChunks = passages?.chunks ?? []
  const passageStart = passages?.startChapter ?? 1
  const passageLabel = sermonPassagesLabel(sermon.passages)
  const activeHighlights =
    effectiveVersion === 'msg'
      ? note.highlightRanges
      : note.highlightVersions[effectiveVersion] ?? EMPTY_RANGES
  const versionNames = t('bibleVersionNames')
  const showVersionToggle = getLang() === 'ko'
  const serviceLabelText =
    sermon.service === 'morning' ? t('sermonServiceMorning') : t('sermonServiceAfternoon')

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col bg-rose-bg text-rose-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rose-line bg-rose-bg/90 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="shrink-0 text-sm font-bold text-rose-key hover:text-rose-accent"
        >
          {t('sermonBack')}
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="min-w-0 truncate font-serif text-base font-extrabold text-rose-ink">
            {sermon.title}
          </h1>
          <p className="mt-0.5 truncate text-xs font-medium text-rose-key">
            {formatEntryDateDot(sermon.preachedOn)} · {serviceLabelText}
            {sermon.preacher ? ` · ${sermon.preacher}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            aria-live="polite"
            className="hidden min-w-14 text-right text-[11px] font-bold text-rose-key/70 sm:inline"
          >
            {statusLabel(saveStatus)}
          </span>
          <LangToggle />
          {user && (
            <button
              type="button"
              onClick={signOut}
              className="hidden whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent sm:inline-flex"
            >
              {t('sermonLogout')}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-5">
        {period && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-line bg-rose-card px-3 py-2">
            <span className="text-xs font-bold text-rose-key">
              {t('sermonPeriod')(formatEntryDateDot(period.start), formatEntryDateDot(period.end))}
            </span>
            {thisWeek && (
              <span className="rounded-full bg-rose-accent-deep px-2 py-0.5 text-[11px] font-black text-white">
                {t('sermonWeekBadge')}
              </span>
            )}
          </div>
        )}

        <section className="rounded-xl border border-rose-line bg-rose-card px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-serif text-sm font-bold tracking-wide text-rose-accent">
              {passageLabel}
            </span>
            {passages && passageChunks.length > 0 && (
              <div className="flex items-center gap-1.5">
                {penColor &&
                  HIGHLIGHT_COLORS.map((color, index) => (
                    <button
                      key={color.color}
                      type="button"
                      aria-label={t('sermonHighlightAria')(t('hlColorNames')[index])}
                      onClick={() => setPenColor(color.color)}
                      className={`h-6 w-6 rounded-full border border-black/10 transition active:scale-90 ${
                        penColor === color.color
                          ? 'ring-2 ring-rose-accent-deep ring-offset-1 ring-offset-rose-card'
                          : ''
                      }`}
                      style={{ background: color.hex }}
                    />
                  ))}
                <button
                  type="button"
                  aria-pressed={!!penColor}
                  onClick={() => setPenColor(penColor ? null : 'gold')}
                  className={`ml-1 rounded-full px-2.5 py-1 text-xs font-bold transition active:scale-[0.98] ${
                    penColor
                      ? 'bg-rose-accent-deep text-white shadow-sm shadow-rose-accent/25'
                      : 'bg-rose-chip text-rose-accent hover:bg-rose-accent-deep hover:text-white'
                  }`}
                >
                  {t('sermonHighlightToggle')}
                </button>
              </div>
            )}
          </div>

          {showVersionToggle && (
            <div className="mt-2 inline-flex select-none rounded-full bg-rose-chip p-0.5">
              {BIBLE_VERSIONS.map((version) => (
                <button
                  key={version}
                  type="button"
                  onClick={() => selectBibleVersion(version)}
                  className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                    bibleVersion === version ? 'bg-rose-accent-deep text-white' : 'text-rose-key'
                  }`}
                >
                  {versionNames[version]}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2">
            {passages ? (
              passageChunks.length > 0 ? (
                <PassageText
                  chunks={passageChunks}
                  startChapter={passageStart}
                  highlightRanges={activeHighlights}
                  onApplyRanges={applyHighlights}
                  onRemoveRange={removeHighlight}
                  penColor={penColor}
                />
              ) : (
                <p className="py-2 text-sm text-rose-key/70">{t('sermonPassageMissing')}</p>
              )
            ) : (
              <p className="py-2 text-sm text-rose-key/70">{t('sermonPassageLoading')}</p>
            )}
          </div>
        </section>

        {(sermon.summary || sermon.mediaUrl) && (
          <section className="space-y-3 rounded-xl border border-rose-line bg-rose-card px-4 py-3 shadow-sm">
            {sermon.summary && (
              <div>
                <h3 className="text-[13px] font-black tracking-[0.14em] text-rose-ink">
                  {t('sermonSummaryTitle')}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-rose-ink">
                  {sermon.summary}
                </p>
              </div>
            )}
            {sermon.mediaUrl && (
              <a
                href={sermon.mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-rose-chip px-3 py-1.5 text-xs font-bold text-rose-accent transition hover:bg-rose-accent-deep hover:text-white"
              >
                <span aria-hidden>▶</span> {t('sermonMediaLink')}
              </a>
            )}
          </section>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[13px] font-black tracking-[0.14em] text-rose-ink">
            {t('sermonMyNote')}
          </span>
          <ModeToggle mode={mode} onChange={setModeAll} />
        </div>

        {sermon.points.length > 0 && (
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 font-serif text-base font-extrabold text-rose-ink">
              <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
              {t('sermonPointsTitle')}
            </h3>
            {sermon.points.map((point, index) => (
              <div key={index} className="space-y-1.5">
                <div className="rounded-xl bg-rose-chip/60 px-3 py-2 text-sm leading-relaxed text-rose-ink">
                  <span className="mr-1.5 font-black text-rose-accent">
                    {t('sermonPointLabel')(index + 1)}
                  </span>
                  <span className="font-medium">{point}</span>
                </div>
                <FieldEditor
                  field={note.pointAnswers[index] ?? { mode, text: '', strokes: [] }}
                  onChange={(field) => updatePointAnswer(index, field)}
                  placeholder={t('sermonPointPlaceholder')}
                  rows={4}
                />
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-serif text-base font-extrabold text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            {t('sermonFreeNote')}
          </h3>
          <FieldEditor
            field={note.freeNote}
            onChange={updateFreeNote}
            placeholder={t('sermonFreeNotePlaceholder')}
            rows={5}
          />
        </section>

        <section>
          <VoiceRecorder entryId={sermon.id} />
        </section>
      </main>

      <div className="safe-pad flex items-center justify-between gap-3 border-t border-rose-line bg-rose-card px-4 py-2.5 sm:hidden">
        <span aria-live="polite" className="text-[12px] font-bold text-rose-key/80">
          {statusLabel(saveStatus)}
        </span>
        {user && (
          <button
            type="button"
            onClick={signOut}
            className="text-[12px] font-bold text-rose-key/80 transition hover:text-rose-accent"
          >
            {t('sermonLogout')}
          </button>
        )}
      </div>
    </div>
  )
}
