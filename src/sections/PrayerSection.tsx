import { emptyField, isFieldEmpty, type Entry, type Field, type FieldMode } from '../types'
import ModeToggle from '../components/ModeToggle'
import { t } from '../i18n/strings'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

/** 기도제목 묶음 + 배우자 기도로 이루어진 한 세트 */
function PrayerSet({
  label,
  topics,
  spouse,
  onTopicChange,
  onAddTopic,
  onRemoveTopic,
  onSpouseChange,
  onRemoveSet,
  FieldEditor,
}: {
  label?: string
  topics: Field[]
  spouse: Field
  onTopicChange: (i: number, value: Field) => void
  onAddTopic: () => void
  onRemoveTopic: (i: number) => void
  onSpouseChange: (value: Field) => void
  onRemoveSet?: () => void
  FieldEditor: typeof import('../components/FieldEditor').default
}) {
  return (
    <div className="space-y-6">
      {label && (
        <div className="flex items-center justify-between border-t border-rose-line pt-6">
          <span className="text-sm font-bold text-rose-key">{label}</span>
          {onRemoveSet && (
            <button
              type="button"
              onClick={onRemoveSet}
              className="text-sm text-rose-key/70 hover:text-rose-accent"
            >
              {t('prayerDeleteSet')}
            </button>
          )}
        </div>
      )}

      {/* 기도제목 */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            {t('prayerTitle')}
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
          <button
            type="button"
            onClick={onAddTopic}
            className="rounded-full bg-rose-accent-deep px-3 py-1 text-sm font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98]"
          >
            {t('prayerAdd')}
          </button>
        </div>
        <div className="space-y-4">
          {topics.map((topic, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-rose-key">{t('prayerTopic')(i + 1)}</span>
                {topics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveTopic(i)}
                    className="text-sm text-rose-key/70 hover:text-rose-accent"
                  >
                    {t('prayerDelete')}
                  </button>
                )}
              </div>
              <FieldEditor
                field={topic}
                onChange={(v) => onTopicChange(i, v)}
                placeholder={t('prayerTopicPlaceholder')}
                rows={2}
                inkHeight={140}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 배우자 기도 */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            {t('prayerSpouse')}
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        </div>
        <FieldEditor
          field={spouse}
          onChange={onSpouseChange}
          placeholder={t('prayerSpousePlaceholder')}
          rows={3}
          inkHeight={160}
        />
      </div>
    </div>
  )
}

export default function PrayerSection({ entry, update, FieldEditor }: Props) {
  const mode = entry.spousePrayer.mode
  const setMode = (m: FieldMode) =>
    update((e) => ({
      ...e,
      spousePrayer: { ...e.spousePrayer, mode: m },
      prayerTopics: e.prayerTopics.map((t) => ({ ...t, mode: m })),
      spousePrayer2: e.spousePrayer2 ? { ...e.spousePrayer2, mode: m } : e.spousePrayer2,
      prayerTopics2: e.prayerTopics2 ? e.prayerTopics2.map((t) => ({ ...t, mode: m })) : e.prayerTopics2,
    }))

  // 세트 1 (기본)
  const setTopic = (i: number, value: Field) =>
    update((e) => {
      const prayerTopics = e.prayerTopics.slice()
      prayerTopics[i] = value
      return { ...e, prayerTopics }
    })
  const addTopic = () =>
    update((e) => ({ ...e, prayerTopics: [...e.prayerTopics, { ...emptyField(), mode }] }))
  const removeTopic = (i: number) =>
    update((e) => ({ ...e, prayerTopics: e.prayerTopics.filter((_, idx) => idx !== i) }))
  const setSpouse = (spousePrayer: Field) => update({ spousePrayer })

  // 세트 2 (옵션)
  const hasSet2 = entry.prayerTopics2 != null
  const addSet = () =>
    update((e) => ({
      ...e,
      prayerTopics2: [{ ...emptyField(), mode }],
      spousePrayer2: { ...emptyField(), mode },
    }))
  const removeSet = () => {
    const dirty =
      (entry.prayerTopics2 ?? []).some((t) => !isFieldEmpty(t)) ||
      (entry.spousePrayer2 != null && !isFieldEmpty(entry.spousePrayer2))
    if (dirty && !window.confirm(t('prayerSet2DeleteConfirm'))) return
    update((e) => ({ ...e, prayerTopics2: undefined, spousePrayer2: undefined }))
  }
  const setTopic2 = (i: number, value: Field) =>
    update((e) => {
      const prayerTopics2 = (e.prayerTopics2 ?? []).slice()
      prayerTopics2[i] = value
      return { ...e, prayerTopics2 }
    })
  const addTopic2 = () =>
    update((e) => ({ ...e, prayerTopics2: [...(e.prayerTopics2 ?? []), { ...emptyField(), mode }] }))
  const removeTopic2 = (i: number) =>
    update((e) => ({ ...e, prayerTopics2: (e.prayerTopics2 ?? []).filter((_, idx) => idx !== i) }))
  const setSpouse2 = (spousePrayer2: Field) => update({ spousePrayer2 })

  return (
    <div className="space-y-6">
      {/* 입력 방식 토글 (모든 기도 칸에 적용) */}
      <div className="flex items-center justify-end">
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      <PrayerSet
        topics={entry.prayerTopics}
        spouse={entry.spousePrayer}
        onTopicChange={setTopic}
        onAddTopic={addTopic}
        onRemoveTopic={removeTopic}
        onSpouseChange={setSpouse}
        FieldEditor={FieldEditor}
      />

      {hasSet2 ? (
        <PrayerSet
          label={t('prayerSet2')}
          topics={entry.prayerTopics2!}
          spouse={entry.spousePrayer2!}
          onTopicChange={setTopic2}
          onAddTopic={addTopic2}
          onRemoveTopic={removeTopic2}
          onSpouseChange={setSpouse2}
          onRemoveSet={removeSet}
          FieldEditor={FieldEditor}
        />
      ) : (
        <button
          type="button"
          onClick={addSet}
          className="w-full rounded-xl border border-dashed border-rose-line py-3 text-sm font-medium text-rose-key transition hover:border-rose-accent hover:text-rose-accent"
        >
          {t('prayerAddSet')}
        </button>
      )}
    </div>
  )
}
