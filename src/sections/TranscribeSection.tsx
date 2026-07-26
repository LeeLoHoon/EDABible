import type { Entry, Field, FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'
import type { PassageInfo } from '../components/BiblePicker'
import TranscribeGuide from '../components/TranscribeGuide'
import { t } from '../i18n/strings'

interface Props {
  entry: Entry
  passage: PassageInfo | null
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

export default function TranscribeSection({ entry, passage, update, FieldEditor }: Props) {
  const setTranscription = (transcription: Field) => update({ transcription })
  const mode = entry.transcription.mode
  const setMode = (m: FieldMode) =>
    update({ transcription: { ...entry.transcription, mode: m } })

  const hasPassage = !!passage && (passage.loading || !!passage.text)

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            {t('transcribeTitle')}
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        {/* 따라쓰기 가이드 — 본문이 스크롤로 사라져도 지금 쓸 구절은 입력칸 위에 남는다 */}
        {hasPassage && !passage!.loading && passage!.chunks.length > 0 && (
          <TranscribeGuide
            chunks={passage!.chunks}
            startChapter={passage!.chapter}
            storageKey={`${entry.id}:${passage!.ref}`}
          />
        )}
        <FieldEditor
          field={entry.transcription}
          onChange={setTranscription}
          placeholder={t('transcribePlaceholder')}
          rows={10}
          inkHeight={360}
          disablePaste
          ariaDescribedBy="transcription-paste-notice"
        />
        {mode === 'text' && (
          <p
            id="transcription-paste-notice"
            className="mt-1.5 px-1 text-[11px] text-rose-key/70"
          >
            {t('transcribePasteBlocked')}
          </p>
        )}
      </div>
    </div>
  )
}
