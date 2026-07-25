import type React from 'react'
import { getQuestionSet, emptyTemptationVictory, type Entry, type Field } from '../types'
import ReadonlyField from './ReadonlyField'
import { formatEntryDateDot } from '../i18n/format'
import { t } from '../i18n/strings'

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-4">
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
      <p className="mb-2 text-[16px] font-bold text-rose-ink">{label}</p>
      {description && <p className="mb-2 text-[13px] leading-relaxed text-rose-key">{description}</p>}
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
    <article className="w-[920px] bg-rose-bg p-10 text-rose-ink">
      <header className="mb-8 border-b border-rose-line pb-5">
        <p className="font-serif text-[34px] font-extrabold text-rose-ink">EDABible</p>
        <div className="mt-2 flex items-end justify-between gap-6">
          <h1 className="font-serif text-[28px] font-bold text-rose-ink">{formatEntryDateDot(entry.date)}</h1>
          <p className="shrink-0 whitespace-nowrap text-right text-[18px] font-semibold text-rose-key">
            {entry.bibleRef || t('homePassageMissing')}
          </p>
        </div>
      </header>

      <div className="space-y-9">
        {sections.transcribe && (
          <Section title={t('shareTranscribe')}>
            <ReadonlyField field={entry.transcription} minHeight={240} />
          </Section>
        )}

        {sections.prayer && (
          <Section title={t('sharePrayer')}>
            <div className="grid grid-cols-2 gap-4">
              {entry.prayerTopics.map((topic, index) => (
                <LabeledField
                  key={index}
                   label={t('sharePrayerTopic')(index + 1)}
                  field={topic}
                  minHeight={96}
                />
              ))}
            </div>
            <LabeledField label={t('shareSpousePrayer')} field={entry.spousePrayer} minHeight={120} />

            {entry.prayerTopics2 && (
              <div className="break-inside-avoid space-y-3 border-t border-rose-line pt-4">
                <p className="text-[15px] font-bold text-rose-key">{t('sharePrayerSet2')}</p>
                <div className="grid grid-cols-2 gap-4">
                  {entry.prayerTopics2.map((topic, index) => (
                    <LabeledField
                      key={index}
                       label={t('sharePrayerTopic')(index + 1)}
                      field={topic}
                      minHeight={96}
                    />
                  ))}
                </div>
                {entry.spousePrayer2 && (
                  <LabeledField label={t('shareSpousePrayer')} field={entry.spousePrayer2} minHeight={120} />
                )}
              </div>
            )}
          </Section>
        )}

        {sections.questions && (
          <Section title={t('shareQuestions')}>
            <div className="space-y-4">
              {getQuestionSet(entry.questionSet).questions.map((question, index) => (
                <LabeledField
                  key={index}
                  label={`${index + 1}. ${question.text}`}
                  description={question.hint}
                  field={entry.answers[index]}
                  minHeight={112}
                />
              ))}
            </div>
          </Section>
        )}

        {sections.victory && (
          <>
            <Section title={t('shareStages')}>
              <LabeledField
                label={t('shareMySin')}
                description={t('shareSinDesc')}
                field={worksheet.sin}
                minHeight={120}
              />
              <div className="rounded-xl border border-rose-line bg-white px-4 py-3">
                <p className="mb-2 text-[16px] font-bold text-rose-ink">{t('shareMyState')}</p>
                <p className="text-[15px] text-rose-ink">
                  {worksheet.stage ? t('tvStages')[worksheet.stage - 1].name : t('shareNoStage')}
                </p>
              </div>
              <LabeledField
                label={t('shareStateNote')}
                description={t('shareStateNoteDesc')}
                field={worksheet.stageNote}
                minHeight={120}
              />
            </Section>

            <Section title={t('shareVictory')}>
              <LabeledField
                label="HELP"
                description={t('shareHelpDesc')}
                field={worksheet.help}
                minHeight={120}
              />
              <LabeledField
                label="PRAY"
                description={t('sharePrayDesc')}
                field={worksheet.pray}
                minHeight={140}
              />
              <LabeledField
                label="VICTORY"
                description={t('shareVictoryDesc')}
                field={worksheet.victory}
                minHeight={140}
              />
              <LabeledField
                label="GROW"
                description={t('shareGrowDesc')}
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
