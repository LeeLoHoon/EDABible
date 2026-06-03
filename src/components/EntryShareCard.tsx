import type React from 'react'
import { QUESTIONS, emptyTemptationVictory, type Entry, type Field } from '../types'
import ReadonlyField from './ReadonlyField'

interface Props {
  entry: Entry
  sections?: ShareSections
}

export interface ShareSections {
  transcribe: boolean
  prayer: boolean
  questions: boolean
  victory: boolean
}

const STAGE_TITLES = [
  '1단계 - 유혹',
  '2단계 - 침투',
  '3단계 - 사건',
  '4단계 - 견고한 진',
  '5단계 - 억압',
  '6단계 - 집착',
  '7단계 - 포로',
] as const

function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  return `${y}.${m}.${d} (${dow})`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-3">
      <h2 className="rounded-xl bg-rose-chip px-4 py-2 text-[18px] font-bold text-rose-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

function LabeledField({
  label,
  description,
  field,
  minHeight,
}: {
  label: string
  description?: string
  field: Field
  minHeight?: number
}) {
  return (
    <div className="break-inside-avoid">
      <p className="mb-1 text-[16px] font-bold text-zinc-700">{label}</p>
      {description && <p className="mb-2 text-[13px] leading-relaxed text-zinc-500">{description}</p>}
      <ReadonlyField field={field} minHeight={minHeight} />
    </div>
  )
}

export default function EntryShareCard({
  entry,
  sections = {
    transcribe: true,
    prayer: true,
    questions: true,
    victory: true,
  },
}: Props) {
  const worksheet = {
    ...emptyTemptationVictory(),
    ...(entry.temptationVictory ?? {}),
  }

  return (
    <article className="w-[920px] bg-rose-bg p-10 text-zinc-700">
      <header className="mb-8 border-b border-rose-line pb-5">
        <p className="font-serif text-[34px] font-extrabold text-rose-ink">EDABible</p>
        <div className="mt-2 flex items-end justify-between gap-6">
          <h1 className="font-serif text-[28px] font-bold text-rose-ink">{formatDate(entry.date)}</h1>
          <p className="text-[18px] font-semibold text-rose-key">{entry.bibleRef || '본문 미입력'}</p>
        </div>
      </header>

      <div className="space-y-8">
        {sections.transcribe && (
          <Section title="필사">
            <ReadonlyField field={entry.transcription} minHeight={240} />
          </Section>
        )}

        {sections.prayer && (
          <Section title="기도">
            <div className="grid grid-cols-2 gap-4">
              {entry.prayerTopics.map((topic, index) => (
                <LabeledField
                  key={index}
                  label={`기도제목 ${index + 1}`}
                  field={topic}
                  minHeight={96}
                />
              ))}
            </div>
            <LabeledField label="배우자 기도" field={entry.spousePrayer} minHeight={120} />
          </Section>
        )}

        {sections.questions && (
          <Section title="5가지 질문">
            <div className="space-y-4">
              {QUESTIONS.map((question, index) => (
                <LabeledField
                  key={question}
                  label={`${index + 1}. ${question}`}
                  field={entry.answers[index]}
                  minHeight={112}
                />
              ))}
            </div>
          </Section>
        )}

        {sections.victory && (
          <>
            <Section title="7가지 단계">
              <LabeledField
                label="나의 죄"
                description="승리하고 싶은 죄 한가지를 떠올려 자세히 적어주세요."
                field={worksheet.sin}
                minHeight={120}
              />
              <div className="rounded-xl border border-rose-line bg-white px-4 py-3">
                <p className="mb-2 text-[16px] font-bold text-zinc-700">나의 상태</p>
                <p className="text-[15px] text-zinc-700">
                  {worksheet.stage ? STAGE_TITLES[worksheet.stage - 1] : '선택된 단계가 없습니다.'}
                </p>
              </div>
              <LabeledField
                label="나의 상태 기록"
                description="선택한 단계에서 내 상태가 어떤지 적은 내용"
                field={worksheet.stageNote}
                minHeight={120}
              />
            </Section>

            <Section title="죄로부터 승리">
              <LabeledField
                label="HELP"
                description="다른 사람에게 요청할 도움이나 중보기도"
                field={worksheet.help}
                minHeight={120}
              />
              <LabeledField
                label="PRAY"
                description="회개기도"
                field={worksheet.pray}
                minHeight={140}
              />
              <LabeledField
                label="VICTORY"
                description="승리 여부와 감사기도"
                field={worksheet.victory}
                minHeight={140}
              />
              <LabeledField
                label="GROW"
                description="승리 후 성장"
                field={worksheet.grow}
                minHeight={140}
              />
            </Section>
          </>
        )}
      </div>
    </article>
  )
}
