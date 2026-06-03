import { emptyField, type Entry, type Field, type FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

export default function PrayerSection({ entry, update, FieldEditor }: Props) {
  const setSpouse = (spousePrayer: Field) => update({ spousePrayer })

  const setTopic = (i: number, value: Field) =>
    update((e) => {
      const prayerTopics = e.prayerTopics.slice()
      prayerTopics[i] = value
      return { ...e, prayerTopics }
    })

  const mode = entry.spousePrayer.mode
  const setMode = (m: FieldMode) =>
    update((e) => ({
      ...e,
      spousePrayer: { ...e.spousePrayer, mode: m },
      prayerTopics: e.prayerTopics.map((t) => ({ ...t, mode: m })),
    }))

  const addTopic = () =>
    update((e) => ({ ...e, prayerTopics: [...e.prayerTopics, { ...emptyField(), mode }] }))

  const removeTopic = (i: number) =>
    update((e) => ({
      ...e,
      prayerTopics: e.prayerTopics.filter((_, idx) => idx !== i),
    }))

  return (
    <div className="space-y-6">
      {/* 입력 방식 토글 (배우자 기도 + 기도제목 전체에 적용) */}
      <div className="flex items-center justify-end">
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* 기도제목 */}
      <div>
        <div className="mb-2 flex items-center justify-between rounded-2xl bg-rose-chip px-4 py-2">
          <h3 className="font-bold text-rose-ink">기도 제목</h3>
          <button
            type="button"
            onClick={addTopic}
            className="rounded-full bg-rose-accent px-3 py-1 text-sm font-medium text-white"
          >
            + 추가
          </button>
        </div>
        <div className="space-y-4">
          {entry.prayerTopics.map((t, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-rose-key">
                  기도제목 {i + 1}
                </span>
                {entry.prayerTopics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTopic(i)}
                    className="text-sm text-zinc-400 hover:text-rose-accent"
                  >
                    삭제
                  </button>
                )}
              </div>
              <FieldEditor
                field={t}
                onChange={(v) => setTopic(i, v)}
                placeholder="→ 기도제목을 적어보세요."
                rows={2}
                inkHeight={140}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 배우자 기도 */}
      <div>
        <div className="mb-2 rounded-2xl bg-rose-chip px-4 py-2">
          <h3 className="font-bold text-rose-ink">배우자 기도</h3>
        </div>
        <FieldEditor
          field={entry.spousePrayer}
          onChange={setSpouse}
          placeholder="배우자(또는 미래의 배우자)를 위한 기도를 적어보세요."
          rows={3}
          inkHeight={160}
        />
      </div>
    </div>
  )
}
