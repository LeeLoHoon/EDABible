import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../authState'
import BackButton from '../components/BackButton'
import FieldEditor from '../components/FieldEditor'
import LangToggle from '../components/LangToggle'
import ModeToggle from '../components/ModeToggle'
import PassageText from '../components/PassageText'
import VoiceRecorder from '../components/VoiceRecorder'
import {
  getSermonNote,
  hasSermonNoteConflict,
  listSermons,
  putSermonNote,
  resolveSermonConflictKeepLocal,
  resolveSermonConflictUseRemote,
  stageSermonNoteLocally,
  type Sermon,
  type SermonNote,
} from '../db'
import {
  loadSermonPassages,
  localizedSermonPassageLabel,
  localizedSermonPoints,
  localizedSermonPreacher,
  localizedSermonSummary,
  localizedSermonTitle,
  SERMON_LIST_PATH,
  type SermonPassageText,
} from '../sermon'
import { isWithinMeditationPeriod, meditationPeriod } from '../sermonWeek'
import { applyRanges, HIGHLIGHT_COLORS, removeRange } from '../highlights'
import { BIBLE_VERSIONS, getBibleVersion, setBibleVersion, type BibleVersion } from '../bibleVersion'
import { getLang } from '../i18n/lang'
import type { Field, FieldMode, HighlightColor, VerseHighlight } from '../types'
import { formatClockTime, formatEntryDateDot } from '../i18n/format'
import { t } from '../i18n/strings'
import { registerSaveFlush } from '../saveFlush'
import { drainPendingRef, ResolvedTaskChain, runSingleFlight } from '../persistenceQueue'

const SAVE_DEBOUNCE_MS = 800

/** memo된 PassageText가 헛되이 재렌더되지 않도록 빈 목록은 안정 참조로 넘긴다 */
const EMPTY_RANGES: VerseHighlight[] = []

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface PendingSermonSave {
  note: SermonNote
  ownerId?: string
}

function readPendingSermonSave(ref: { current: PendingSermonSave | null }): PendingSermonSave | null {
  return ref.current
}

function isStaleSermonNoteError(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes('SERMON_NOTE_STALE_REVISION')
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes('SERMON_NOTE_STALE_REVISION')
  )
}

function isOwnerChangedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : ''
  return (
    message.includes('SERMON_NOTE_OWNER_CHANGED') ||
    message.includes('SERMON_NOTE_OWNER_MISMATCH')
  )
}

/* 저장이 왜 실패했는지는 화면에 드러나야 한다 — 폰에서는 콘솔을 볼 수 없어서
   '저장 실패' 네 글자만으로는 사용자도 우리도 원인을 알 방법이 없다.
   Supabase 오류는 Error가 아니라 {code, message}를 가진 객체로 온다. */
function describeSaveFailure(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error !== 'object' || error === null) return String(error ?? '')
  const detail = error as { code?: unknown; message?: unknown }
  const code = typeof detail.code === 'string' ? detail.code : ''
  const message = typeof detail.message === 'string' ? detail.message : ''
  return [code, message].filter(Boolean).join(': ')
}

/* 저장 상태는 늘 한 줄 떠 있어야 한다 — 자동 저장이라 버튼을 누른 기억이 없으면
   '저장됐나?' 하는 불안이 남는다. 한 번이라도 저장했으면 그 시각을 계속 보여준다. */
function statusLabel(status: SaveStatus, errorMessage: string, lastSavedAt: number | null): string {
  if (status === 'saving') return t('sermonSaving')
  if (status === 'error') return errorMessage || t('sermonSaveErrorInline')
  if (lastSavedAt !== null) return t('sermonSavedAt')(formatClockTime(lastSavedAt))
  if (status === 'saved') return t('sermonSaved')
  return t('sermonSaveNotYet')
}

export default function SermonNotePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, signOut, signInWithGoogle } = useAuth()
  const userId = user?.id
  // 묵상 작성은 로그인 계정에만 쌓는다 — 기기에만 남으면 폰을 바꿀 때 통째로 사라진다.
  // 열람(본문·요약)은 로그인 없이도 열어 두어 처음 온 사람이 내용을 볼 수 있게 한다.
  const canWrite = !!userId

  const [sermon, setSermon] = useState<Sermon | null>(null)
  const [note, setNote] = useState<SermonNote | null>(null)
  const [passages, setPassages] = useState<SermonPassageText | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<FieldMode>('text')
  const [penColor, setPenColor] = useState<HighlightColor | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [saveErrorMessage, setSaveErrorMessage] = useState('')
  const [saveConflict, setSaveConflict] = useState(false)
  const [displayedOwnerId, setDisplayedOwnerId] = useState<string | undefined>(userId)
  const [bibleVersion, setBibleVersionState] = useState<BibleVersion>(() => getBibleVersion())
  // 영어 모드는 역본 축이 없다(항상 영어 The Message) — 형광펜도 기본 저장소를 쓴다
  const effectiveVersion: BibleVersion = getLang() === 'en' ? 'msg' : bibleVersion

  const saveTimerRef = useRef<number | null>(null)
  const pendingNoteRef = useRef<PendingSermonSave | null>(null)
  const flushPromiseRef = useRef<Promise<void> | null>(null)
  const saveChainRef = useRef(new ResolvedTaskChain())
  const displayedOwnerRef = useRef<string | undefined>(userId)
  const activeAuthOwnerRef = useRef<string | undefined>(userId)
  const saveConflictRef = useRef(false)

  useEffect(() => {
    activeAuthOwnerRef.current = userId
  }, [userId])

  const runOneSave = useCallback(async (pending: PendingSermonSave) => {
    try {
      if (pending.ownerId && activeAuthOwnerRef.current !== pending.ownerId) {
        throw new Error('SERMON_NOTE_OWNER_CHANGED')
      }
      const saved = await putSermonNote({ ...pending.note }, pending.ownerId)
      if (displayedOwnerRef.current === pending.ownerId) {
        setNote((current) =>
          current?.sermonId === saved.sermonId
            ? { ...current, revision: saved.revision }
            : current,
        )
      }
      const newer = pendingNoteRef.current
      const hasNewerPending = newer !== null && newer !== pending
      if (
        hasNewerPending &&
        newer.ownerId === pending.ownerId &&
        newer.note.sermonId === saved.sermonId &&
        newer.note.revision < saved.revision
      ) {
        pendingNoteRef.current = {
          ...newer,
          note: { ...newer.note, revision: saved.revision },
        }
      }
      saveConflictRef.current = false
      setSaveConflict(false)
      setSaveErrorMessage('')
      // 뒤이어 저장할 게 남아 있어도 서버에 한 번 닿은 것은 사실이라 시각은 갱신한다
      setLastSavedAt(Date.now())
      if (!hasNewerPending) setSaveStatus('saved')
    } catch (error) {
      if (!pendingNoteRef.current) pendingNoteRef.current = pending
      const conflict = isStaleSermonNoteError(error)
      if (conflict && saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      saveConflictRef.current = conflict
      setSaveConflict(conflict)
      setSaveErrorMessage(
        isOwnerChangedError(error)
          ? t('sermonSaveOwnerChanged')
          : t('sermonSaveErrorWithReason')(describeSaveFailure(error)),
      )
      setSaveStatus('error')
      throw error
    }
  }, [])

  const flush = useCallback((): Promise<void> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (flushPromiseRef.current) return flushPromiseRef.current
    if (saveConflictRef.current) return Promise.reject(new Error('SERMON_NOTE_STALE_REVISION'))
    return runSingleFlight(flushPromiseRef, () =>
      drainPendingRef(pendingNoteRef, (pending) =>
        saveChainRef.current.run(() => runOneSave(pending)),
      ),
    )
  }, [runOneSave])

  useEffect(() => {
    if (!id) return
    let alive = true

    ;(async () => {
      try {
        await flush()
      } catch {
        if (alive) setLoading(false)
        return
      }
      if (!alive) return
      setLoading(true)
      setNotFound(false)
      setSermon(null)
      setNote(null)
      setPassages(null)
      const list = await listSermons()
      if (!alive) return
      const target = list.find((s) => s.id === id)
      if (!target) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const loadedNote = await getSermonNote(
        target.id,
        localizedSermonPoints(target, getLang()).length,
        userId,
      )
      const loadedConflict = await hasSermonNoteConflict(target.id, userId)
      if (!alive) return
      displayedOwnerRef.current = userId
      setDisplayedOwnerId(userId)
      setSermon(target)
      setNote(loadedNote)
      saveConflictRef.current = loadedConflict
      setSaveConflict(loadedConflict)
      setSaveErrorMessage(loadedConflict ? t('sermonSaveErrorInline') : '')
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
  }, [flush, id, userId])

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
          setPassages({
            ref: sermon.passages
              .map((passage) => localizedSermonPassageLabel(passage, getLang()))
              .join(', '),
            chunks: [],
            startChapter: 1,
          })
        }
      })
    return () => {
      alive = false
    }
    // bibleVersion이 바뀌면 같은 본문을 새 역본으로 다시 불러온다(loadBook이 저장된 역본을 읽는다)
  }, [sermon, bibleVersion])

  const scheduleSave = useCallback(
    (next: SermonNote) => {
      pendingNoteRef.current = { note: next, ownerId: userId }
      void stageSermonNoteLocally(next, userId).catch((error) => {
        console.warn('Sermon note could not be staged locally.', error)
        setSaveErrorMessage(t('sermonSaveErrorInline'))
        setSaveStatus('error')
      })
      if (saveConflictRef.current) return
      setSaveConflict(false)
      setSaveErrorMessage('')
      setSaveStatus('saving')
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flush().catch(() => undefined)
      }, SAVE_DEBOUNCE_MS)
    },
    [flush, userId],
  )

  useEffect(() => {
    const unregister = registerSaveFlush(flush)
    const onPageHide = () => void flush().catch(() => undefined)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush().catch(() => undefined)
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unregister()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void flush().catch(() => undefined)
    }
  }, [flush])

  const leaveForList = async () => {
    try {
      await flush()
      navigate(SERMON_LIST_PATH)
    } catch (error) {
      // 저장 오류를 화면에 유지하고 현재 계정의 편집 화면을 떠나지 않는다.
      console.warn('Sermon navigation was blocked by an unfinished save.', error)
    }
  }

  const handleSignOut = async () => {
    try {
      await flush()
      await signOut()
    } catch (error) {
      // 계정 소유 저장이 끝나지 않으면 로그아웃하지 않는다.
      console.warn('Sermon sign-out was blocked by an unfinished save.', error)
    }
  }

  const reloadAfterConflict = async () => {
    if (!sermon || !userId) return
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingNoteRef.current = null
    setLoading(true)
    try {
      await saveChainRef.current.wait()
      const loaded = await resolveSermonConflictUseRemote(
        sermon.id,
        localizedSermonPoints(sermon, getLang()).length,
        userId,
      )
      displayedOwnerRef.current = userId
      setDisplayedOwnerId(userId)
      setNote(loaded)
      setMode(loaded.freeNote.mode)
      saveChainRef.current.reset()
      pendingNoteRef.current = null
      saveConflictRef.current = false
      setSaveConflict(false)
      setSaveErrorMessage('')
      setSaveStatus('idle')
    } catch (error) {
      setSaveErrorMessage(
        isOwnerChangedError(error) ? t('sermonSaveOwnerChanged') : t('sermonSaveErrorInline'),
      )
      setSaveStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const keepMineAfterConflict = async () => {
    if (!note || !userId) return
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingNoteRef.current = null
    setSaveStatus('saving')
    try {
      await saveChainRef.current.wait()
      const saved = await resolveSermonConflictKeepLocal(note, userId)
      if (displayedOwnerRef.current !== userId) return
      setNote((current) =>
        current?.sermonId === saved.sermonId
          ? { ...current, revision: saved.revision }
          : current,
      )
      const newer = readPendingSermonSave(pendingNoteRef)
      if (newer && newer.ownerId === userId && newer.note.sermonId === saved.sermonId) {
        pendingNoteRef.current = {
          ...newer,
          note: { ...newer.note, revision: saved.revision },
        }
      }
      saveChainRef.current.reset()
      saveConflictRef.current = false
      setSaveConflict(false)
      setSaveErrorMessage('')
      if (pendingNoteRef.current) {
        setSaveStatus('saving')
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          void flush().catch(() => undefined)
        }, SAVE_DEBOUNCE_MS)
      } else {
        setSaveStatus('saved')
      }
    } catch (error) {
      saveConflictRef.current = true
      setSaveConflict(true)
      setSaveErrorMessage(
        isOwnerChangedError(error) ? t('sermonSaveOwnerChanged') : t('sermonSaveErrorInline'),
      )
      setSaveStatus('error')
    }
  }

  const updateNote = useCallback(
    (updater: (prev: SermonNote) => SermonNote) => {
      setNote((prev) => {
        if (!prev) return prev
        const next = {
          ...updater(prev),
          updatedAt: Math.max(Date.now(), prev.updatedAt + 1),
        }
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
  const updateImpression = (field: Field) => {
    updateNote((prev) => ({ ...prev, impression: field }))
  }
  const updateApplication = (field: Field) => {
    updateNote((prev) => ({ ...prev, application: field }))
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
      impression: { ...prev.impression, mode: nextMode },
      application: { ...prev.application, mode: nextMode },
      freeNote: { ...prev.freeNote, mode: nextMode },
    }))
  }

  if (loading) {
    return <div className="p-8 text-center text-rose-key/70">{t('sermonNoteLoading')}</div>
  }
  if (notFound || !sermon || !note || displayedOwnerId !== userId) {
    return (
      <div className="p-8 text-center text-rose-key">
        <p>{t('sermonNotFound')}</p>
        <BackButton
          onClick={() => void leaveForList()}
          label={t('navBackList')}
          className="mt-3"
        />
      </div>
    )
  }

  const period = meditationPeriod(sermon.preachedOn)
  const thisWeek = isWithinMeditationPeriod(sermon.preachedOn, new Date())
  const lang = getLang()
  const sermonTitle = localizedSermonTitle(sermon, lang)
  const sermonPreacher = localizedSermonPreacher(sermon, lang)
  const sermonSummary = localizedSermonSummary(sermon, lang)
  const sermonPoints = localizedSermonPoints(sermon, lang)
  const passageChunks = passages?.chunks ?? []
  const passageStart = passages?.startChapter ?? 1
  const passageLabel = sermon.passages
    .map((passage) => localizedSermonPassageLabel(passage, lang))
    .join(', ')
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
        <BackButton onClick={() => void leaveForList()} label={t('navBackList')} />
        <div className="min-w-0 flex-1 text-center">
          <h1 className="min-w-0 truncate font-serif text-base font-extrabold text-rose-ink">
            {sermonTitle}
          </h1>
          <p className="mt-0.5 truncate text-xs font-medium text-rose-key">
            {formatEntryDateDot(sermon.preachedOn)} · {serviceLabelText}
            {sermonPreacher ? ` · ${sermonPreacher}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LangToggle />
          {user && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="hidden whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent sm:inline-flex"
            >
              {t('sermonLogout')}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 space-y-5 px-4 py-5">
        {saveConflict && (
          <div role="alert" className="rounded-xl border border-rose-accent/50 bg-rose-card px-4 py-3 text-sm text-rose-key shadow-sm">
            <p className="font-bold text-rose-accent">{t('sermonSaveConflict')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void reloadAfterConflict()}
                className="min-h-11 rounded-full border border-rose-accent/60 bg-white px-4 py-2 font-bold text-rose-accent transition hover:bg-rose-accent hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-accent"
              >
                {t('sermonConflictReload')}
              </button>
              <button
                type="button"
                onClick={() => void keepMineAfterConflict()}
                className="min-h-11 rounded-full bg-rose-accent px-4 py-2 font-bold text-white transition hover:bg-rose-accent-deep focus:outline-none focus:ring-2 focus:ring-rose-accent"
              >
                {t('sermonConflictKeepMine')}
              </button>
            </div>
          </div>
        )}
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
            {canWrite && passages && passageChunks.length > 0 && (
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
                  onApplyRanges={canWrite ? applyHighlights : undefined}
                  onRemoveRange={canWrite ? removeHighlight : undefined}
                  penColor={canWrite ? penColor : null}
                />
              ) : (
                <p className="py-2 text-sm text-rose-key/70">{t('sermonPassageMissing')}</p>
              )
            ) : (
              <p className="py-2 text-sm text-rose-key/70">{t('sermonPassageLoading')}</p>
            )}
          </div>
        </section>

        {(sermonSummary || sermon.mediaUrl) && (
          <section className="space-y-3 rounded-xl border border-rose-line bg-rose-card px-4 py-3 shadow-sm">
            {sermonSummary && (
              <div>
                <h3 className="text-[13px] font-black tracking-[0.14em] text-rose-ink">
                  {t('sermonSummaryTitle')}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-rose-ink">
                  {sermonSummary}
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

        {!canWrite && (
          <section className="rounded-2xl border border-dashed border-rose-accent/50 bg-rose-card px-4 py-6 text-center shadow-sm">
            <h3 className="font-serif text-base font-extrabold text-rose-ink">
              {t('sermonSignInTitle')}
            </h3>
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
            <p className="mt-3 text-xs leading-relaxed text-rose-key/70">
              {t('sermonSignInLocalHint')}
            </p>
          </section>
        )}

        {canWrite && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-black tracking-[0.14em] text-rose-ink">
                {t('sermonMyNote')}
              </span>
              <ModeToggle mode={mode} onChange={setModeAll} />
            </div>

            {sermonPoints.length > 0 && (
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 font-serif text-base font-extrabold text-rose-ink">
                  <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                  {t('sermonPointsTitle')}
                </h3>
                {sermonPoints.map((point, index) => (
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
                {t('sermonImpression')}
              </h3>
              <FieldEditor
                field={note.impression}
                onChange={updateImpression}
                placeholder={t('sermonImpressionPlaceholder')}
                rows={4}
              />
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-serif text-base font-extrabold text-rose-ink">
                <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
                {t('sermonApplication')}
              </h3>
              <FieldEditor
                field={note.application}
                onChange={updateApplication}
                placeholder={t('sermonApplicationPlaceholder')}
                rows={4}
              />
            </section>

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
          </>
        )}
      </main>

      {/* 자동 저장이라 손이 갈 곳이 없으면 불안하다. 상태와 저장 버튼을 늘 바닥에 붙여 둔다. */}
      {canWrite && (
        <div className="safe-pad sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-rose-line bg-rose-card/95 px-4 py-2.5 backdrop-blur">
          {/* 실패 사유는 길 수 있어 잘라내지 않는다 — 잘린 오류는 없는 것과 같다 */}
          <span
            aria-live="polite"
            className={`min-w-0 flex-1 text-[12px] font-bold ${
              saveStatus === 'error'
                ? 'whitespace-normal break-words text-rose-accent'
                : 'truncate text-rose-key/80'
            }`}
          >
            {statusLabel(saveStatus, saveErrorMessage, lastSavedAt)}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="text-[12px] font-bold text-rose-key/80 transition hover:text-rose-accent sm:hidden"
            >
              {t('sermonLogout')}
            </button>
            {/* 저장은 곧 '이 묵상을 마쳤다'는 뜻이라 목록으로 돌려보낸다.
                저장에 실패하면 leaveForList가 화면을 지켜 에러를 볼 수 있게 한다. */}
            <button
              type="button"
              onClick={() => void leaveForList()}
              disabled={saveStatus === 'saving'}
              className="min-h-9 rounded-full bg-rose-accent-deep px-4 py-1.5 text-[13px] font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
            >
              {saveStatus === 'saving' ? t('sermonSavingButton') : t('sermonSaveNow')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
