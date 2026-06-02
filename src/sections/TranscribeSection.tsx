import type { Entry, Field, FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'

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
      {/* 본문 참조 입력 */}
      <div className="rounded-2xl bg-rose-chip px-4 py-3">
        <label className="mb-1 block text-sm font-semibold text-rose-ink">
          오늘의 본문 (장·절)
        </label>
        <input
          type="text"
          value={entry.bibleRef}
          onChange={(e) => update({ bibleRef: e.target.value })}
          placeholder="예: 시편 3편"
          className="w-full rounded-xl border border-rose-line bg-white px-3 py-2 text-lg font-medium text-rose-ink outline-none focus:border-rose-accent"
        />
        <p className="mt-2 text-sm text-rose-key/70">
          📖 본문은 성경(앱·책)에서 직접 읽고, 아래에 필사하세요.
        </p>
      </div>

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
