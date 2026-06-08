import {
  QUESTION_SETS,
  getQuestionSet,
  type Entry,
  type Field,
  type FieldMode,
  type QuestionSetId,
} from '../types'
import ModeToggle from '../components/ModeToggle'

interface Props {
  entry: Entry
  update: (patch: Partial<Entry> | ((e: Entry) => Entry)) => void
  FieldEditor: typeof import('../components/FieldEditor').default
}

/** 질문 문장에서 키워드를 색으로 강조 */
function Question({ text, keyword }: { text: string; keyword: string }) {
  const idx = text.indexOf(keyword)
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-bold text-rose-key">{keyword}</span>
      {text.slice(idx + keyword.length)}
    </>
  )
}

/** 사용할 질문 세트를 고르는 토글 */
function SetToggle({
  value,
  onChange,
}: {
  value: QuestionSetId
  onChange: (id: QuestionSetId) => void
}) {
  return (
    <div className="inline-flex select-none rounded-full bg-rose-chip p-0.5">
      {QUESTION_SETS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={`rounded-full px-3 py-1 text-sm font-medium transition ${
            value === s.id ? 'bg-rose-accent text-white' : 'text-rose-ink'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

export default function QuestionsSection({ entry, update, FieldEditor }: Props) {
  const set = getQuestionSet(entry.questionSet)

  const setAnswer = (i: number, value: Field) =>
    update((e) => {
      const answers = e.answers.slice()
      answers[i] = value
      return { ...e, answers }
    })

  const mode = entry.answers[0]?.mode ?? 'text'
  const setMode = (m: FieldMode) =>
    update((e) => ({ ...e, answers: e.answers.map((a) => ({ ...a, mode: m })) }))

  const setQuestionSet = (id: QuestionSetId) => update({ questionSet: id })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="rounded-2xl bg-rose-chip px-4 py-2">
          <h3 className="font-bold text-rose-ink">5가지 질문</h3>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      <SetToggle value={set.id} onChange={setQuestionSet} />
      {set.questions.map((q, i) => (
        <div key={i}>
          <p className="mb-2 text-[17px] font-semibold text-zinc-700">
            <span className="mr-1 text-rose-accent">{i + 1}.</span>
            <Question text={q.text} keyword={q.keyword} />
            {q.hint && <span className="ml-1 text-[13px] font-normal text-zinc-400">({q.hint})</span>}
          </p>
          <FieldEditor
            field={entry.answers[i]}
            onChange={(v) => setAnswer(i, v)}
            placeholder="→ 오늘 하루를 돌아보며 적어보세요."
            rows={3}
            inkHeight={160}
          />
        </div>
      ))}
    </div>
  )
}
