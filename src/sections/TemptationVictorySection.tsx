import {
  emptyTemptationVictory,
  type Entry,
  type Field,
  type FieldMode,
  type TemptationVictory,
} from '../types'
import ModeToggle from '../components/ModeToggle'
import { t } from '../i18n/strings'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

export default function TemptationVictorySection({ entry, update, FieldEditor }: Props) {
  const worksheet = entry.temptationVictory ?? emptyTemptationVictory()
  const mode = worksheet.sin.mode

  const setWorksheet = (patch: Partial<TemptationVictory>) =>
    update((e) => ({
      ...e,
      temptationVictory: {
        ...(e.temptationVictory ?? emptyTemptationVictory()),
        ...patch,
      },
    }))

  const setField = (
    key: keyof Pick<TemptationVictory, 'sin' | 'stageNote' | 'help' | 'pray' | 'victory' | 'grow'>,
    value: Field,
  ) =>
    setWorksheet({ [key]: value })

  const setMode = (nextMode: FieldMode) =>
    update((e) => {
      const current = e.temptationVictory ?? emptyTemptationVictory()
      return {
        ...e,
        temptationVictory: {
          ...current,
          sin: { ...current.sin, mode: nextMode },
          stageNote: { ...current.stageNote, mode: nextMode },
          help: { ...current.help, mode: nextMode },
          pray: { ...current.pray, mode: nextMode },
          victory: { ...current.victory, mode: nextMode },
          grow: { ...current.grow, mode: nextMode },
        },
      }
    })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
          <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
          {t('tvTitle')}
        </h3>
        <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      <section className="space-y-3">
        <div>
          <p className="mb-2 text-[17px] font-semibold text-rose-ink">{t('tvMySin')}</p>
          <p className="mb-2 text-sm text-rose-key">
            {t('tvSinDesc')}
          </p>
          <FieldEditor
            field={worksheet.sin}
            onChange={(v) => setField('sin', v)}
            placeholder={t('tvSinPlaceholder')}
            rows={4}
            inkHeight={180}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-[17px] font-semibold text-rose-ink">{t('tvMyState')}</p>
          <p className="text-sm text-rose-key">
            {t('tvStateDesc')}
          </p>
        </div>
        <div className="space-y-3">
          {t('tvStages').map((stage, index) => {
            const stageNumber = index + 1
            const selected = worksheet.stage === stageNumber
            return (
              <button
                 key={stage.name}
                type="button"
                onClick={() => setWorksheet({ stage: selected ? null : stageNumber })}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selected
                    ? 'border-rose-accent bg-rose-chip text-rose-ink'
                    : 'border-rose-line bg-rose-card text-rose-ink'
                }`}
              >
                <span className="mb-1 flex items-center gap-2 font-bold">
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${
                      selected
                        ? 'border-leaf-deep bg-leaf-deep text-white'
                        : 'border-rose-line text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                   {stage.name}
                </span>
                 <span className="block text-sm leading-relaxed">{stage.desc}</span>
              </button>
            )
          })}
        </div>
        <FieldEditor
          field={worksheet.stageNote}
          onChange={(v) => setField('stageNote', v)}
          placeholder={t('tvStatePlaceholder')}
          rows={4}
          inkHeight={180}
        />
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            {t('tvVictory')}
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        </div>
        {t('tvFields').map((item, index) => {
          const key = item.key as keyof Pick<TemptationVictory, 'help' | 'pray' | 'victory' | 'grow'>
          const rows = index === 0 ? 4 : 5
          const inkHeight = index === 0 ? 180 : 210
          return (
          <div key={key}>
            <p className="mb-1 text-[17px] font-semibold text-rose-ink">{item.title}</p>
            <p className="mb-2 text-sm text-rose-key">{item.description}</p>
            <FieldEditor
              field={worksheet[key]}
              onChange={(v) => setField(key, v)}
              placeholder={item.placeholder}
              rows={rows}
              inkHeight={inkHeight}
            />
          </div>
          )
        })}
      </section>
    </div>
  )
}
