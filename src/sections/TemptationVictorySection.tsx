import {
  emptyTemptationVictory,
  type Entry,
  type Field,
  type FieldMode,
  type TemptationVictory,
} from '../types'
import ModeToggle from '../components/ModeToggle'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

const STAGES = [
  {
    title: '1단계 - 유혹',
    body: '사탄은 가장 먼저 조용한 생각을 통해 우리를 유혹합니다. “생각만 하는 거니까 괜찮지 않겠어?”라며 우리를 점점 부정적으로 물들입니다.',
  },
  {
    title: '2단계 - 침투',
    body: '거부하지 않은 생각을 반복하게 합니다. 반복되면 익숙해지고, 익숙해지면 그것이 사실이라고 믿게 됩니다. 이 단계에서는 계속되는 죄 된 생각을 거부하기 어렵고, 그걸 행동으로 옮기기도 합니다.',
  },
  {
    title: '3단계 - 사건',
    body: '사소하게 여겼던 죄 된 행동이 모여 고난, 질병, 관계 파탄, 재정문제 등 인생에 여러가지 사건 사고가 발생하게 됩니다.',
  },
  {
    title: '4단계 - 견고한 진',
    body: '“하나님은 날 버렸어. 내 기도는 듣지 않아.” 하나님을 원망하고 저주하는 생각들이 내 안에 요새처럼 자리 잡습니다. 다른 부분은 잘 하니까 이 정도 죄는 넘어갈 수 있다고 생각하며 죄를 보호합니다.',
  },
  {
    title: '5단계 - 억압',
    body: '죄가 습관이 되어서 나를 억압합니다. 계속해서 죄를 짓고, 죄책감을 느끼지만 불구하고 온전히 회개가 되지 않습니다. 결국 믿음에 균열이 가고 사울왕처럼 성령님이 떠나가고 사탄이 계속 억압합니다.',
  },
  {
    title: '6단계 - 집착',
    body: '사탄이 내 정체성 자체를 공격합니다. 내 자아를 깨뜨려서 영적 위기라는 사실 자체를 잊어버립니다. 사탄이 주는 정체성을 자기 자신이라고 믿으며 더 깊은 어둠 속으로 들어갑니다.',
  },
  {
    title: '7단계 - 포로',
    body: '자신의 의지가 완전히 제압된 상태입니다. 죄가 시키는 대로 하며, 죄에 중독되어 죄가 나의 힐링의 도구가 되어 스스로를 파괴합니다. 어떤 방법으로도 치료가 되지 않고 예수그리스도의 강력한 권세와 중보만으로 치유가 가능한 단계입니다.',
  },
] as const

const VICTORY_FIELDS = [
  {
    key: 'help',
    title: 'HELP',
    description: '다른 사람에게 요청할 도움이나 중보기도를 적어 주세요.',
    placeholder: '도움을 요청할 사람, 필요한 중보기도, 나눌 내용을 적어보세요.',
    rows: 4,
    inkHeight: 180,
  },
  {
    key: 'pray',
    title: 'PRAY',
    description: '어떤 회개를 할 것인지 생각하며, 회개기도를 적어 주세요.',
    placeholder: '주님 앞에서 고백할 죄와 회개기도를 적어보세요.',
    rows: 5,
    inkHeight: 210,
  },
  {
    key: 'victory',
    title: 'VICTORY',
    description: '죄로부터 승리하셨나요? 승리 여부와 감사기도를 적어 주세요.',
    placeholder: '승리한 부분, 아직 싸우는 부분, 감사기도를 적어보세요.',
    rows: 5,
    inkHeight: 210,
  },
  {
    key: 'grow',
    title: 'GROW',
    description: '죄의 뿌리를 뽑은 곳에는 올바른 것을 심어야 합니다. 승리 후 어떤 성장을 하고 있는지 적어주세요.',
    placeholder: '새롭게 심을 습관, 말씀, 관계, 실천을 적어보세요.',
    rows: 5,
    inkHeight: 210,
  },
] satisfies {
  key: keyof Pick<TemptationVictory, 'help' | 'pray' | 'victory' | 'grow'>
  title: string
  description: string
  placeholder: string
  rows: number
  inkHeight: number
}[]

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
          7가지 단계
        </h3>
        <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      <section className="space-y-3">
        <div>
          <p className="mb-2 text-[17px] font-semibold text-rose-ink">나의 죄</p>
          <p className="mb-2 text-sm text-rose-key">
            승리하고 싶은 죄 한가지를 떠올려 자세히 적어주세요.
          </p>
          <FieldEditor
            field={worksheet.sin}
            onChange={(v) => setField('sin', v)}
            placeholder="승리하고 싶은 죄 한가지를 구체적으로 적어보세요."
            rows={4}
            inkHeight={180}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-[17px] font-semibold text-rose-ink">나의 상태</p>
          <p className="text-sm text-rose-key">
            7가지 단계 중 내가 해당하는 상태를 선택하고, 현재 상태를 자세히 적어주세요.
          </p>
        </div>
        <div className="space-y-3">
          {STAGES.map((stage, index) => {
            const stageNumber = index + 1
            const selected = worksheet.stage === stageNumber
            return (
              <button
                key={stage.title}
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
                  {stage.title}
                </span>
                <span className="block text-sm leading-relaxed">{stage.body}</span>
              </button>
            )
          })}
        </div>
        <FieldEditor
          field={worksheet.stageNote}
          onChange={(v) => setField('stageNote', v)}
          placeholder="선택한 단계에서 내 상태가 어떤지 구체적으로 적어보세요."
          rows={4}
          inkHeight={180}
        />
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
            죄로부터 승리
          </h3>
          <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        </div>
        {VICTORY_FIELDS.map((item) => (
          <div key={item.key}>
            <p className="mb-1 text-[17px] font-semibold text-rose-ink">{item.title}</p>
            <p className="mb-2 text-sm text-rose-key">{item.description}</p>
            <FieldEditor
              field={worksheet[item.key]}
              onChange={(v) => setField(item.key, v)}
              placeholder={item.placeholder}
              rows={item.rows}
              inkHeight={item.inkHeight}
            />
          </div>
        ))}
      </section>
    </div>
  )
}
