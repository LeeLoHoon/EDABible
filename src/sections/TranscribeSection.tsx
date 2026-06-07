import { useState } from 'react'
import type { Entry, Field, FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'
import BiblePicker, { type PassageInfo } from '../components/BiblePicker'

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
  const hasPassage = !!passage && (passage.loading || !!passage.text)

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
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={passage!.loading}
              className="flex w-full items-center justify-between gap-2 disabled:opacity-100"
            >
              <span className="font-serif text-sm font-bold tracking-wide text-rose-accent">
                {passage!.book} {passage!.chapter}장
              </span>
              {!passage!.loading && (
                <span className="shrink-0 text-xs font-medium text-rose-key">
                  {open ? '접기 ▴' : '펼치기 ▾'}
                </span>
              )}
            </button>

            {passage!.loading ? (
              <div className="mt-2 animate-pulse space-y-2.5 py-0.5" aria-label="본문 불러오는 중">
                <div className="h-3 w-full rounded bg-rose-line/50" />
                <div className="h-3 w-[92%] rounded bg-rose-line/50" />
                <div className="h-3 w-[70%] rounded bg-rose-line/50" />
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
                <p className="whitespace-pre-wrap font-serif text-[15px] leading-[1.7] text-zinc-700">
                  {passage!.text}
                </p>
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
