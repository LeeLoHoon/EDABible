import type { Entry, Field, FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'
import BiblePicker from '../components/BiblePicker'

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

  return (
    <div className="space-y-4">
      {/* 본문 선택 (성경·장) */}
      <BiblePicker
        value={entry.bibleRef}
        onChange={(bibleRef) => update({ bibleRef })}
      />

      {/* 필사 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-rose-ink">필사</h3>
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
