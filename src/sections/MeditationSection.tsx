import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Entry, HighlightColor, VerseHighlight } from '../types'
import type { PassageInfo } from '../components/BiblePicker'
import PassageText from '../components/PassageText'
import VoiceRecorder from '../components/VoiceRecorder'
import PrayerSection from './PrayerSection'
import { useDockedTextarea } from '../hooks/useDockedTextarea'
import { applyRanges, HIGHLIGHT_COLORS, removeRange } from '../highlights'
import { t } from '../i18n/strings'

interface Props {
  entry: Entry
  passage: PassageInfo | null
  setPassage: Dispatch<SetStateAction<PassageInfo | null>>
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

/**
 * 개발자 모드 — '완료됨' 배지를 연속 7번 탭하면 켜지고, 7번 더 탭하면 꺼진다.
 * 켜져 있는 동안에만 완료 해제 버튼이 보인다. 일반 사용자가 완료본을 실수로
 * 덮어쓰는 것을 막는 장치이지 보안 경계는 아니다 (노트 앱은 로그인이 없다).
 */
const DEV_MODE_KEY = 'edabible:devMode'
const DEV_MODE_TAPS = 7
/** 탭 간격이 이보다 벌어지면 카운터를 리셋해 우연한 누적을 막는다 */
const DEV_MODE_TAP_RESET_MS = 2000

// 사파리 프라이빗 모드 등에서 localStorage 접근이 던질 수 있다
function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1'
  } catch {
    return false
  }
}

function writeDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_MODE_KEY, '1')
    else localStorage.removeItem(DEV_MODE_KEY)
  } catch {
    // 저장에 실패하면 이번 세션 동안만 켜진 상태로 둔다
  }
}

/** Supabase 오류는 Error가 아닌 평범한 객체라 String()이 '[object Object]'가 된다 */
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return String(e)
}

export default function MeditationSection({
  entry,
  passage,
  setPassage,
  update,
  FieldEditor,
}: Props) {
  // 형광펜 드래그 하이라이트 — 겹침 절단·같은 색 병합은 applyRanges가 처리,
  // 저장은 기존 debounce+flush 파이프라인 그대로
  const applyHighlights = useCallback(
    (adds: VerseHighlight[]) =>
      update((e) => ({ ...e, highlightRanges: applyRanges(e.highlightRanges ?? [], adds) })),
    [update],
  )
  const removeHighlight = useCallback(
    (key: string, start: number, end: number) =>
      update((e) => ({ ...e, highlightRanges: removeRange(e.highlightRanges ?? [], key, start, end) })),
    [update],
  )

  // 형광펜 상태 — null이면 꺼짐
  const [penColor, setPenColor] = useState<HighlightColor | null>(null)

  const [open, setOpen] = useState(true)
  const [editingPassage, setEditingPassage] = useState(false)
  const [passageDraft, setPassageDraft] = useState('')
  const [savingPassage, setSavingPassage] = useState(false)
  const [finalizingPassage, setFinalizingPassage] = useState(false)
  const [passageSaveError, setPassageSaveError] = useState<string | null>(null)
  const {
    textareaRef: passageTextareaRef,
    textareaStyle: passageTextareaStyle,
    slotStyle: passageTextareaSlotStyle,
    handlePointerDown: handlePassagePointerDown,
    handleFocus: handlePassageFocus,
    handleBlur: handlePassageBlur,
  } = useDockedTextarea()
  const [showPassageFormatHelp, setShowPassageFormatHelp] = useState(false)
  const previousPassageKeyRef = useRef('')

  // 히든 개발자 모드 — '완료됨' 배지 연속 탭으로만 토글된다
  const [devMode, setDevMode] = useState(readDevMode)
  const [unfinalizingPassage, setUnfinalizingPassage] = useState(false)
  const devTapCountRef = useRef(0)
  const devTapTimerRef = useRef<number | null>(null)
  const hasPassage = !!passage && (passage.loading || !!passage.text)
  const passageKey = passage
    ? `${passage.book}:${passage.chapter}:${passage.endChapter}:${passage.ref}`
    : ''

  useEffect(() => {
    const previousKey = previousPassageKeyRef.current
    previousPassageKeyRef.current = passageKey

    if (!passage) {
      // 여러 편집 상태를 현재 passage prop과 함께 초기화하는 기존 동기화 effect다.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPassageDraft('')
      setPassageSaveError(null)
      setEditingPassage(false)
      setFinalizingPassage(false)
      setShowPassageFormatHelp(false)
      return
    }

    if (previousKey && previousKey !== passageKey && editingPassage) {
      setEditingPassage(false)
      setSavingPassage(false)
      setFinalizingPassage(false)
      setPassageDraft(passage.text)
      setPassageSaveError(null)
      setShowPassageFormatHelp(false)
      return
    }

    if (editingPassage) return
    setPassageDraft(passage.text)
    setPassageSaveError(null)
  }, [editingPassage, passage, passageKey])

  const startPassageEdit = () => {
    if (!passage?.canEdit) return
    setOpen(true)
    setShowPassageFormatHelp(false)
    setPassageDraft(passage.text)
    setPassageSaveError(null)
    setEditingPassage(true)
  }

  const cancelPassageEdit = () => {
    setPassageDraft(passage?.text ?? '')
    setPassageSaveError(null)
    setEditingPassage(false)
  }

  const savePassageEdit = async () => {
    if (!passage?.canEdit) return
    setSavingPassage(true)
    setPassageSaveError(null)
    try {
      await passage.saveText(passageDraft)
      setPassage((prev) => (prev ? { ...prev, text: passageDraft } : prev))
      setEditingPassage(false)
    } catch (e) {
      setPassageSaveError(errorText(e))
    } finally {
      setSavingPassage(false)
    }
  }

  useEffect(
    () => () => {
      if (devTapTimerRef.current) window.clearTimeout(devTapTimerRef.current)
    },
    [],
  )

  const countDevModeTap = () => {
    if (devTapTimerRef.current) window.clearTimeout(devTapTimerRef.current)
    devTapCountRef.current += 1

    if (devTapCountRef.current >= DEV_MODE_TAPS) {
      devTapCountRef.current = 0
      const next = !devMode
      setDevMode(next)
      writeDevMode(next)
      return
    }

    devTapTimerRef.current = window.setTimeout(() => {
      devTapCountRef.current = 0
    }, DEV_MODE_TAP_RESET_MS)
  }

  const unfinalizePassage = async () => {
    if (!passage?.canUnfinalize) return
    if (!confirm(t('transcribeUnfinalizeConfirm')(passage.ref))) {
      return
    }

    setUnfinalizingPassage(true)
    setPassageSaveError(null)
    try {
      await passage.unfinalize()
      setPassage((prev) =>
        prev
          ? {
              ...prev,
              isFinalized: false,
              canEdit: true,
              canFinalize: true,
              canUnfinalize: false,
            }
          : prev,
      )
    } catch (e) {
      setPassageSaveError(errorText(e))
    } finally {
      setUnfinalizingPassage(false)
    }
  }

  const completePassageEdit = async () => {
    if (!passage?.canFinalize) return
    if (!confirm(t('transcribeFinalizeConfirm')(passage.ref))) {
      return
    }

    setFinalizingPassage(true)
    setPassageSaveError(null)
    try {
      if (passageDraft !== passage.text) {
        await passage.saveText(passageDraft)
      }
      await passage.finalize()
      setPassage((prev) =>
        prev
          ? {
              ...prev,
              text: passageDraft,
              isFinalized: true,
              canEdit: false,
              canFinalize: false,
            }
          : prev,
      )
      setEditingPassage(false)
    } catch (e) {
      setPassageSaveError(errorText(e))
    } finally {
      setFinalizingPassage(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 본문 — sticky 고정 금지. 모바일에서 필사 영역과 겹쳐 스크롤이 어색해진다 */}
      {hasPassage && (
        <div className="rounded-xl border border-rose-line bg-rose-card px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={passage!.loading || editingPassage}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 disabled:opacity-100"
            >
              <span className="min-w-0 truncate font-serif text-sm font-bold tracking-wide text-rose-accent">
                {passage!.ref}
              </span>
              {!passage!.loading && !editingPassage && (
                <span className="shrink-0 text-xs font-medium text-rose-key">
                  {open ? t('transcribeCollapse') : t('transcribeExpand')}
                </span>
              )}
            </button>
            {!passage!.loading && passage!.canEdit && !editingPassage && (
              <div className="relative flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowPassageFormatHelp((value) => !value)}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-rose-line bg-white text-xs font-black text-rose-key shadow-sm"
                  aria-expanded={showPassageFormatHelp}
                  aria-label={t('transcribeEditHelpView')}
                  title={t('transcribeEditHelp')}
                >
                  ?
                </button>
                <button
                  type="button"
                  onClick={startPassageEdit}
                  className="rounded-lg bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent"
                >
                  {t('transcribeEdit')}
                </button>
                {showPassageFormatHelp && (
                  <div className="absolute right-0 top-9 z-20 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-rose-line bg-white p-3 text-left text-xs leading-relaxed text-rose-ink shadow-lg">
                    <p className="font-bold text-rose-accent">{t('transcribeEditHelp')}</p>
                    <div className="mt-2 rounded-lg bg-rose-bg/70 p-2 font-mono text-[11px] leading-relaxed text-rose-ink">
                      <p>[[{t('transcribeFormatTitle')}]]</p>
                      <p>(1-3) {t('transcribeFormatBody')}</p>
                      <p>(4-6) {t('transcribeFormatBody')}</p>
                      <p className="mt-2">[[{t('transcribeFormatMiddleTitle')}]]</p>
                      <p>(7-10) {t('transcribeFormatBody')}</p>
                    </div>
                    <ul className="mt-2 space-y-1 text-rose-key">
                      <li>{t('transcribeHelpTitleRule')}</li>
                      <li>{t('transcribeHelpVerseRule')}</li>
                      <li>{t('transcribeHelpUnknownRule')}</li>
                    </ul>
                  </div>
                )}
              </div>
            )}
            {!passage!.loading && passage!.isFinalized && (
              <div className="flex shrink-0 items-center gap-1.5">
                {devMode && passage!.canUnfinalize && (
                  <button
                    type="button"
                    onClick={unfinalizePassage}
                    disabled={unfinalizingPassage}
                    className="rounded-full border border-rose-accent/60 bg-white px-2.5 py-1 text-xs font-bold text-rose-accent transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {unfinalizingPassage ? t('transcribeUnfinalizing') : t('transcribeUnfinalize')}
                  </button>
                )}
                {/* 연속 7번 탭이 개발자 모드를 토글한다 — 겉보기는 그대로 배지 */}
                <button
                  type="button"
                  onClick={countDevModeTap}
                  aria-label={t('transcribeFinalized')}
                  className="touch-manipulation rounded-lg bg-leaf-pale/70 px-2.5 py-1 text-xs font-bold text-leaf-deep"
                >
                  {t('transcribeFinalized')}
                </button>
              </div>
            )}
          </div>

          {/* 완료 해제 실패 등, 편집 중이 아닐 때 생기는 오류 */}
          {passageSaveError && !editingPassage && (
            <p className="mt-1 text-right text-xs text-red-500">{passageSaveError}</p>
          )}

          {/* 형광펜 툴바 — 켜면 본문을 긋는 대로 칠해진다 (선택·복사 메뉴 없음) */}
          {!passage!.loading && !editingPassage && open && (
            <div className="mt-2 flex items-center justify-end gap-1.5">
              {penColor &&
                 HIGHLIGHT_COLORS.map((c, index) => (
                  <button
                    key={c.color}
                    type="button"
                     aria-label={t('transcribeHighlightAria')(t('hlColorNames')[index])}
                    onClick={() => setPenColor(c.color)}
                    className={`h-6 w-6 rounded-full border border-black/10 transition active:scale-90 ${
                      penColor === c.color
                        ? 'ring-2 ring-rose-accent-deep ring-offset-1 ring-offset-rose-card'
                        : ''
                    }`}
                    style={{ background: c.hex }}
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
                {t('transcribeHighlight')}
              </button>
            </div>
          )}

          {passage!.loading ? (
            <div className="mt-2 animate-pulse space-y-2.5 py-0.5" aria-label={t('transcribeLoadingPassage')}>
              <div className="h-3 w-full rounded bg-rose-line/50" />
              <div className="h-3 w-[92%] rounded bg-rose-line/50" />
              <div className="h-3 w-[70%] rounded bg-rose-line/50" />
            </div>
          ) : editingPassage ? (
            <div className="mt-2 space-y-2">
              <div style={passageTextareaSlotStyle}>
                <textarea
                  ref={passageTextareaRef}
                  style={passageTextareaStyle}
                  onPointerDown={handlePassagePointerDown}
                  onFocus={handlePassageFocus}
                  onBlur={handlePassageBlur}
                  value={passageDraft}
                  onChange={(event) => setPassageDraft(event.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="block min-h-[12rem] w-full rounded-xl border border-rose-line bg-white px-3 py-2 font-serif text-[16px] leading-[1.75] text-rose-ink outline-none focus:border-rose-accent"
                  aria-label={t('transcribeEditAria')(passage!.ref)}
                />
              </div>
              {passageSaveError && <p className="text-xs text-red-500">{passageSaveError}</p>}
              <div className="flex justify-end gap-2">
                {passage!.canFinalize && (
                  <button
                    type="button"
                    onClick={completePassageEdit}
                    disabled={savingPassage || finalizingPassage}
                    className="rounded-full border border-rose-accent/60 bg-white px-3 py-2 text-xs font-bold text-rose-accent transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {finalizingPassage ? t('transcribeFinalizing') : t('transcribeSaveFinalize')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={cancelPassageEdit}
                  disabled={savingPassage || finalizingPassage}
                  className="rounded-full border border-rose-line bg-white px-3 py-2 text-xs font-bold text-rose-key transition hover:border-rose-accent/50 hover:text-rose-accent active:scale-[0.98] disabled:opacity-50"
                >
                  {t('transcribeCancel')}
                </button>
                <button
                  type="button"
                  onClick={savePassageEdit}
                  disabled={savingPassage || finalizingPassage}
                  className="rounded-full bg-rose-accent-deep px-3 py-2 text-xs font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
                >
                  {savingPassage ? t('transcribeSaving') : t('transcribeSave')}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={`${passage!.book}-${passage!.chapter}-${open}`}
              className={
                open ? 'mt-2' : 'relative mt-2 max-h-[3.4rem] overflow-hidden'
              }
              style={{ animation: 'fadeIn 0.3s ease' }}
            >
              <PassageText
                chunks={passage!.chunks}
                startChapter={passage!.chapter}
                highlightRanges={entry.highlightRanges}
                onApplyRanges={applyHighlights}
                onRemoveRange={removeHighlight}
                penColor={penColor}
              />
              {/* 접힘 상태일 때 아래쪽 페이드로 '더 있음' 암시 */}
              {!open && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-rose-card to-transparent" />
              )}
            </div>
          )}
          {/* 첫 사용자 힌트 — 하이라이트가 하나라도 생기면 사라진다 */}
          {open &&
            !passage!.loading &&
            !editingPassage &&
            (entry.highlightRanges?.length ?? 0) === 0 && (
              <p className="mt-2 border-t border-rose-line/60 pt-1.5 text-[11px] text-rose-key/70">
                {t('transcribeHighlightHint')}
              </p>
            )}
        </div>
      )}

      <VoiceRecorder entryId={entry.id} />

      <PrayerSection entry={entry} update={update} FieldEditor={FieldEditor} />
    </div>
  )
}
