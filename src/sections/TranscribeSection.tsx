import { useEffect, useRef, useState } from 'react'
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

  // 현재 본문 + 펼침 상태 (기본은 접힘 — 필사 공간 확보)
  const [passage, setPassage] = useState<PassageInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [editingPassage, setEditingPassage] = useState(false)
  const [passageDraft, setPassageDraft] = useState('')
  const [savingPassage, setSavingPassage] = useState(false)
  const [finalizingPassage, setFinalizingPassage] = useState(false)
  const [passageSaveError, setPassageSaveError] = useState<string | null>(null)
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
      return
    }

    if (previousKey && previousKey !== passageKey && editingPassage) {
      setEditingPassage(false)
      setSavingPassage(false)
      setFinalizingPassage(false)
      setPassageDraft(passage.text)
      setPassageSaveError(null)
      return
    }

    if (editingPassage) return
    setPassageDraft(passage.text)
    setPassageSaveError(null)
  }, [editingPassage, passage, passageKey])

  const startPassageEdit = () => {
    if (!passage?.canEdit) return
    setOpen(true)
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
    if (!confirm(`${passage.ref} 본문을 완료 처리할까요?\n완료 후에는 이 화면에서 더 이상 수정할 수 없습니다.`)) {
      return
    }

    setFinalizingPassage(true)
    setPassageSaveError(null)
    try {
      await passage.finalize()
      setPassage((prev) => (prev ? { ...prev, isFinalized: true, canEdit: false } : prev))
      setEditingPassage(false)
    } catch (e) {
      setPassageSaveError(String(e instanceof Error ? e.message : e))
    } finally {
      setFinalizingPassage(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 본문 선택 (성경·장) */}
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
                <span className="min-w-0 truncate font-serif text-sm font-bold tracking-wide text-rose-accent">
                  {passage!.ref}
                </span>
                {!passage!.loading && !editingPassage && (
                  <span className="shrink-0 text-xs font-medium text-rose-key">
                    {open ? '접기 ▴' : '펼치기 ▾'}
                  </span>
                )}
              </button>
              {!passage!.loading && passage!.canEdit && !editingPassage && (
                <button
                  type="button"
                  onClick={startPassageEdit}
                  className="shrink-0 rounded-lg bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent"
                >
                  본문 수정
                </button>
              )}
              {!passage!.loading && passage!.isFinalized && (
                <span className="shrink-0 rounded-lg bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-key">
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
                  className="min-h-[12rem] w-full rounded-xl border border-rose-line bg-white px-3 py-2 font-serif text-[15px] leading-[1.75] text-zinc-700 outline-none focus:border-rose-accent"
                  aria-label={`${passage!.ref} 본문 수정`}
                />
                {passageSaveError && <p className="text-xs text-red-500">{passageSaveError}</p>}
                <div className="flex justify-end gap-2">
                  {passage!.canFinalize && (
                    <button
                      type="button"
                      onClick={completePassageEdit}
                      disabled={savingPassage || finalizingPassage}
                      className="rounded-lg border border-rose-accent bg-white px-3 py-2 text-xs font-bold text-rose-accent disabled:opacity-50"
                    >
                      {finalizingPassage ? '완료 중' : '완료'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancelPassageEdit}
                    disabled={savingPassage || finalizingPassage}
                    className="rounded-lg border border-rose-line bg-white px-3 py-2 text-xs font-bold text-rose-key disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={savePassageEdit}
                    disabled={savingPassage || finalizingPassage}
                    className="rounded-lg bg-rose-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
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
                <PassageText text={passage!.text} />
                {/* 접힘 상태일 때 아래쪽 페이드로 '더 있음' 암시 */}
                {!open && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-rose-card to-transparent" />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 필사 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-700">필사</h3>
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
