import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry, Field, FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'
import BiblePicker, { type PassageInfo } from '../components/BiblePicker'
import PassageText from '../components/PassageText'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

export default function TranscribeSection({ entry, update, FieldEditor }: Props) {
  const setTranscription = (transcription: Field) => update({ transcription })
  const mode = entry.transcription.mode
  const setMode = (m: FieldMode) =>
    update({ transcription: { ...entry.transcription, mode: m } })

  // 구절 하이라이트(형광 밑줄) 토글 — 저장은 기존 debounce+flush 파이프라인 그대로
  const toggleVerse = useCallback(
    (verseKey: string) =>
      update((e) => {
        const current = e.highlightedVerses ?? []
        return {
          ...e,
          highlightedVerses: current.includes(verseKey)
            ? current.filter((k) => k !== verseKey)
            : [...current, verseKey],
        }
      }),
    [update],
  )

  // 현재 본문 + 펼침 상태
  const [passage, setPassage] = useState<PassageInfo | null>(null)
  const [open, setOpen] = useState(true)
  const [editingPassage, setEditingPassage] = useState(false)
  const [passageDraft, setPassageDraft] = useState('')
  const [savingPassage, setSavingPassage] = useState(false)
  const [finalizingPassage, setFinalizingPassage] = useState(false)
  const [passageSaveError, setPassageSaveError] = useState<string | null>(null)
  const [showPassageFormatHelp, setShowPassageFormatHelp] = useState(false)
  const previousPassageKeyRef = useRef('')
  const hasPassage = !!passage && (passage.loading || !!passage.text)
  const passageKey = passage
    ? `${passage.book}:${passage.chapter}:${passage.endChapter}:${passage.ref}`
    : ''

  useEffect(() => {
    const previousKey = previousPassageKeyRef.current
    previousPassageKeyRef.current = passageKey

    if (!passage) {
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
      setPassageSaveError(String(e instanceof Error ? e.message : e))
    } finally {
      setSavingPassage(false)
    }
  }

  const completePassageEdit = async () => {
    if (!passage?.canFinalize) return
    if (!confirm(`${passage.ref} 본문을 저장하고 완료 처리할까요?\n완료 후에는 이 화면에서 더 이상 수정할 수 없습니다.`)) {
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
      setPassageSaveError(String(e instanceof Error ? e.message : e))
    } finally {
      setFinalizingPassage(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 본문 선택 (성경·장/편) */}
      <BiblePicker
        value={entry.bibleRef}
        onChange={(bibleRef) => update({ bibleRef })}
        onPassage={setPassage}
      />

      {/* 본문 — 헤더 아래에 sticky 고정. 필사하며 스크롤해도 항상 보임 */}
      {hasPassage && (
        <div className="sticky top-[52px] z-[5]">
          <div className="rounded-xl border border-rose-line bg-rose-card px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={passage!.loading || editingPassage}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 disabled:opacity-100"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate font-serif text-sm font-bold tracking-wide text-rose-accent">
                    {passage!.ref}
                  </span>
                  {!passage!.loading && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide ${
                        passage!.sourceQuality === 'verified'
                          ? 'bg-leaf-pale/60 text-leaf-deep'
                          : 'bg-white/70 text-rose-key'
                      }`}
                    >
                      {passage!.sourceQuality === 'verified' ? 'V' : 'F'}
                    </span>
                  )}
                </span>
                {!passage!.loading && !editingPassage && (
                  <span className="shrink-0 text-xs font-medium text-rose-key">
                    {open ? '접기 ▴' : '펼치기 ▾'}
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
                    aria-label="본문 수정 방법 보기"
                    title="본문 수정 방법"
                  >
                    ?
                  </button>
                  <button
                    type="button"
                    onClick={startPassageEdit}
                    className="rounded-lg bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent"
                  >
                    본문 수정
                  </button>
                  {showPassageFormatHelp && (
                    <div className="absolute right-0 top-9 z-20 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-rose-line bg-white p-3 text-left text-xs leading-relaxed text-rose-ink shadow-lg">
                      <p className="font-bold text-rose-accent">본문 수정 방법</p>
                      <div className="mt-2 rounded-lg bg-rose-bg/70 p-2 font-mono text-[11px] leading-relaxed text-rose-ink">
                        <p>[[제목]]</p>
                        <p>(1-3) 본문 내용...</p>
                        <p>(4-6) 본문 내용...</p>
                        <p className="mt-2">[[중간 제목]]</p>
                        <p>(7-10) 본문 내용...</p>
                      </div>
                      <ul className="mt-2 space-y-1 text-rose-key">
                        <li>제목은 <b>[[제목]]</b>으로 단독 줄에 씁니다.</li>
                        <li>절은 <b>(1)</b> 또는 <b>(1-3)</b>처럼 문단 앞에 씁니다.</li>
                        <li>절 구분이 확실하지 않으면 절 표기는 쓰지 않습니다.</li>
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {!passage!.loading && passage!.isFinalized && (
                <span className="shrink-0 rounded-lg bg-leaf-pale/70 px-2.5 py-1 text-xs font-bold text-leaf-deep">
                  완료됨
                </span>
              )}
            </div>

            {passage!.loading ? (
              <div className="mt-2 animate-pulse space-y-2.5 py-0.5" aria-label="본문 불러오는 중">
                <div className="h-3 w-full rounded bg-rose-line/50" />
                <div className="h-3 w-[92%] rounded bg-rose-line/50" />
                <div className="h-3 w-[70%] rounded bg-rose-line/50" />
              </div>
            ) : editingPassage ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={passageDraft}
                  onChange={(event) => setPassageDraft(event.target.value)}
                  autoFocus
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-h-[12rem] w-full rounded-xl border border-rose-line bg-white px-3 py-2 font-serif text-[15px] leading-[1.75] text-rose-ink outline-none focus:border-rose-accent"
                  aria-label={`${passage!.ref} 본문 수정`}
                />
                {passageSaveError && <p className="text-xs text-red-500">{passageSaveError}</p>}
                <div className="flex justify-end gap-2">
                  {passage!.canFinalize && (
                    <button
                      type="button"
                      onClick={completePassageEdit}
                      disabled={savingPassage || finalizingPassage}
                      className="rounded-full border border-rose-accent/60 bg-white px-3 py-2 text-xs font-bold text-rose-accent transition active:scale-[0.98] disabled:opacity-50"
                    >
                      {finalizingPassage ? '완료 중' : '저장 후 완료'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancelPassageEdit}
                    disabled={savingPassage || finalizingPassage}
                    className="rounded-full border border-rose-line bg-white px-3 py-2 text-xs font-bold text-rose-key transition hover:border-rose-accent/50 hover:text-rose-accent active:scale-[0.98] disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={savePassageEdit}
                    disabled={savingPassage || finalizingPassage}
                    className="rounded-full bg-rose-accent-deep px-3 py-2 text-xs font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {savingPassage ? '저장 중' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={`${passage!.book}-${passage!.chapter}-${open}`}
                className={
                  open
                    ? 'mt-2 max-h-[min(50vh,18rem)] overflow-y-auto'
                    : 'relative mt-2 max-h-[3.4rem] overflow-hidden'
                }
                style={{ animation: 'fadeIn 0.3s ease' }}
              >
                <PassageText
                  text={passage!.text}
                  startChapter={passage!.chapter}
                  highlights={entry.highlightedVerses}
                  onToggleVerse={toggleVerse}
                />
                {/* 접힘 상태일 때 아래쪽 페이드로 '더 있음' 암시 */}
                {!open && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-rose-card to-transparent" />
                )}
              </div>
            )}
            {/* 첫 사용자 힌트 — 하이라이트가 하나라도 생기면 사라진다 */}
            {open && !passage!.loading && !editingPassage && (entry.highlightedVerses?.length ?? 0) === 0 && (
              <p className="mt-2 border-t border-rose-line/60 pt-1.5 text-[11px] text-rose-key/70">
                구절을 탭하면 형광 밑줄로 표시됩니다
              </p>
            )}
          </div>
        </div>
      )}

      {/* 필사 */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            필사
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <FieldEditor
          field={entry.transcription}
          onChange={setTranscription}
          placeholder="읽은 본문을 한 자 한 자 옮겨 적어보세요."
          rows={10}
          inkHeight={360}
        />
      </div>
    </div>
  )
}
