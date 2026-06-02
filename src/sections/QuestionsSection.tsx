import { QUESTIONS, QUESTION_KEYWORDS, type Entry, type Field, type FieldMode } from '../types'
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

export default function QuestionsSection({ entry, update, FieldEditor }: Props) {
  const setAnswer = (i: number, value: Field) =>
    update((e) => {
      const answers = e.answers.slice()
      answers[i] = value
      return { ...e, answers }
    })

  const mode = entry.answers[0]?.mode ?? 'text'
  const setMode = (m: FieldMode) =>
    update((e) => ({ ...e, answers: e.answers.map((a) => ({ ...a, mode: m })) }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl bg-rose-chip px-4 py-2">
          <h3 className="font-bold text-rose-ink">5가지 질문</h3>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      {QUESTIONS.map((q, i) => (
        <div key={i}>
          <p className="mb-2 text-[17px] font-semibold text-zinc-700">
            <span className="mr-1 text-rose-accent">{i + 1}.</span>
            <Question text={q} keyword={QUESTION_KEYWORDS[i]} />
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
