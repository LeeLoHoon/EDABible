import { useEffect, useMemo, useState } from 'react'
import { parseRefs } from '../bible'
import BiblePicker from './BiblePicker'
import {
  deleteSermon,
  upsertSermon,
  type Sermon,
  type SermonPassage,
  type SermonService,
} from '../db'
import { sermonPassageLabel } from '../sermon'
import { isSunday } from '../sermonWeek'
import { t } from '../i18n/strings'

interface Props {
  /** 편집 대상 설교. null이면 신규 등록 폼 */
  initial: Sermon | null
  onClose: () => void
  onSaved: () => void
}

interface FormDraft {
  id: string
  service: SermonService
  preachedOn: string
  title: string
  preacher: string
  /** BiblePicker가 요구하는 참조 문자열 — 절 라벨은 여기 담지 않는다 */
  refText: string
  /** 파싱된 본문마다 짝지어 저장할 절 범위 표기(관리자 표시용) */
  verseLabels: string[]
  summary: string
  points: string[]
  mediaUrl: string
  published: boolean
}

function makeDraft(sermon: Sermon | null): FormDraft {
  if (!sermon) {
    return {
      id: crypto.randomUUID(),
      service: 'morning',
      preachedOn: '',
      title: '',
      preacher: '',
      refText: '',
      verseLabels: [],
      summary: '',
      points: [''],
      mediaUrl: '',
      published: false,
    }
  }

  return {
    id: sermon.id,
    service: sermon.service,
    preachedOn: sermon.preachedOn,
    title: sermon.title,
    preacher: sermon.preacher,
    // BiblePicker는 절 라벨을 모르니 장 단위 문자열만 넘긴다 — 절 라벨은 verseLabels로 분리 보관
    refText: sermon.passages
      .map((p) => sermonPassageLabel({ ...p, verseLabel: undefined }))
      .join(', '),
    verseLabels: sermon.passages.map((p) => p.verseLabel ?? ''),
    summary: sermon.summary,
    points: sermon.points.length > 0 ? sermon.points : [''],
    mediaUrl: sermon.mediaUrl,
    published: sermon.published,
  }
}

export default function SermonAdminForm({ initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<FormDraft>(() => makeDraft(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const parsedPassages = useMemo(() => parseRefs(draft.refText), [draft.refText])

  useEffect(() => {
    // BiblePicker가 본문을 늘리거나 지우면 절 라벨 배열도 동일 길이로 유지 —
    // parsedPassages와 verseLabels가 인덱스 기준으로 짝을 이룬다는 불변식을 지킨다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((prev) => {
      if (prev.verseLabels.length === parsedPassages.length) return prev
      const nextLabels = Array.from(
        { length: parsedPassages.length },
        (_, index) => prev.verseLabels[index] ?? '',
      )
      return { ...prev, verseLabels: nextLabels }
    })
  }, [parsedPassages.length])

  const sundayWarn = draft.preachedOn.length > 0 && !isSunday(draft.preachedOn)

  const patch = (updates: Partial<FormDraft>) => setDraft((prev) => ({ ...prev, ...updates }))

  const updatePoint = (index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      points: prev.points.map((point, i) => (i === index ? value : point)),
    }))
  }
  const addPoint = () => setDraft((prev) => ({ ...prev, points: [...prev.points, ''] }))
  const removePoint = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      points: prev.points.length <= 1 ? prev.points : prev.points.filter((_, i) => i !== index),
    }))
  }
  const updateVerseLabel = (index: number, value: string) => {
    setDraft((prev) => ({
      ...prev,
      verseLabels: prev.verseLabels.map((label, i) => (i === index ? value : label)),
    }))
  }

  const handleSave = async () => {
    if (!draft.preachedOn) {
      setError(t('sermonPreachedOnRequired'))
      return
    }
    if (!draft.title.trim()) {
      setError(t('sermonTitleRequired'))
      return
    }
    if (parsedPassages.length === 0) {
      setError(t('sermonNoPassages'))
      return
    }

    setSaving(true)
    setError(null)

    const passages: SermonPassage[] = parsedPassages.map((passage, index) => {
      const label = draft.verseLabels[index]?.trim()
      return {
        book: passage.book,
        chapter: passage.chapter,
        endChapter: passage.endChapter,
        ...(label ? { verseLabel: label } : {}),
      }
    })
    const points = draft.points.map((p) => p.trim()).filter((p) => p.length > 0)

    const sermon: Sermon = {
      id: draft.id,
      service: draft.service,
      preachedOn: draft.preachedOn,
      title: draft.title.trim(),
      preacher: draft.preacher.trim(),
      passages,
      summary: draft.summary.trim(),
      points,
      mediaUrl: draft.mediaUrl.trim(),
      published: draft.published,
      updatedAt: Date.now(),
    }

    try {
      await upsertSermon(sermon)
      onSaved()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(t('sermonSaveError')(message))
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!initial) return
    if (!window.confirm(t('sermonDeleteConfirm')(initial.title))) return
    setSaving(true)
    setError(null)
    try {
      await deleteSermon(initial.id)
      onSaved()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(t('sermonSaveError')(message))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-rose-ink/45 p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-rose-line bg-rose-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-rose-line px-4 py-3">
          <h2 className="font-serif text-lg font-extrabold text-rose-ink">
            {initial ? t('sermonAdminEditTitle') : t('sermonAdminNewTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="grid h-8 w-8 place-items-center rounded-full text-rose-key transition hover:bg-rose-chip disabled:opacity-40"
            aria-label={t('sermonCancel')}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <label className="block space-y-1">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldPreachedOn')}
            </span>
            <input
              type="date"
              value={draft.preachedOn}
              onChange={(event) => patch({ preachedOn: event.target.value })}
              className="block w-full rounded-xl border border-rose-line bg-white px-3 py-2 text-base text-rose-ink outline-none focus:border-rose-accent"
            />
            {sundayWarn && (
              <span className="block text-xs font-bold text-rose-accent">
                {t('sermonNotSundayWarn')}
              </span>
            )}
          </label>

          <fieldset>
            <legend className="text-sm font-bold text-rose-ink">{t('sermonFieldService')}</legend>
            <div className="mt-1 flex gap-2">
              {(['morning', 'afternoon'] as SermonService[]).map((service) => {
                const active = draft.service === service
                return (
                  <label
                    key={service}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-sm font-bold transition ${
                      active
                        ? 'border-rose-accent-deep bg-rose-accent-deep text-white'
                        : 'border-rose-line bg-white text-rose-key hover:border-rose-accent/50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name="sermon-service"
                      value={service}
                      checked={active}
                      onChange={() => patch({ service })}
                    />
                    {service === 'morning'
                      ? t('sermonServiceMorning')
                      : t('sermonServiceAfternoon')}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="block space-y-1">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldTitle')}
            </span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              className="block w-full rounded-xl border border-rose-line bg-white px-3 py-2 text-base text-rose-ink outline-none focus:border-rose-accent"
            />
          </label>

          <label className="block space-y-1">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldPreacher')}
            </span>
            <input
              type="text"
              value={draft.preacher}
              onChange={(event) => patch({ preacher: event.target.value })}
              className="block w-full rounded-xl border border-rose-line bg-white px-3 py-2 text-base text-rose-ink outline-none focus:border-rose-accent"
            />
          </label>

          <div className="space-y-2">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldPassages')}
            </span>
            <BiblePicker
              value={draft.refText}
              onChange={(refText) => patch({ refText })}
              fixedBookOrder={null}
            />

            {parsedPassages.length > 0 && (
              <div className="space-y-1.5 rounded-xl border border-rose-line bg-white/60 p-3">
                <span className="block text-xs font-bold text-rose-key">
                  {t('sermonFieldVerseLabel')}
                </span>
                {parsedPassages.map((passage, index) => {
                  const range =
                    passage.endChapter !== passage.chapter
                      ? `${passage.chapter}~${passage.endChapter}`
                      : String(passage.chapter)
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-rose-ink">
                        {t('sermonPassageRow')(index + 1)} · {passage.book} {range}
                      </span>
                      <input
                        type="text"
                        value={draft.verseLabels[index] ?? ''}
                        onChange={(event) => updateVerseLabel(index, event.target.value)}
                        placeholder={t('sermonVerseLabelPlaceholder')}
                        className="w-40 rounded-lg border border-rose-line bg-white px-2 py-1 text-sm text-rose-ink outline-none focus:border-rose-accent"
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldSummary')}
            </span>
            <textarea
              value={draft.summary}
              onChange={(event) => patch({ summary: event.target.value })}
              rows={4}
              placeholder={t('sermonSummaryPlaceholder')}
              className="block w-full resize-y rounded-xl border border-rose-line bg-white p-3 text-base leading-relaxed text-rose-ink outline-none focus:border-rose-accent"
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-rose-ink">{t('sermonFieldPoints')}</span>
              <button
                type="button"
                onClick={addPoint}
                className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-bold text-rose-accent transition hover:bg-rose-accent-deep hover:text-white"
              >
                {t('sermonAddPoint')}
              </button>
            </div>
            {draft.points.map((point, index) => (
              <div key={index} className="flex items-start gap-2">
                <textarea
                  value={point}
                  onChange={(event) => updatePoint(index, event.target.value)}
                  rows={2}
                  placeholder={t('sermonPointInputPlaceholder')(index + 1)}
                  className="block flex-1 resize-y rounded-xl border border-rose-line bg-white p-2.5 text-sm leading-relaxed text-rose-ink outline-none focus:border-rose-accent"
                />
                <button
                  type="button"
                  onClick={() => removePoint(index)}
                  disabled={draft.points.length <= 1}
                  className="mt-0.5 rounded-full px-2 py-1 text-xs font-bold text-rose-key transition hover:text-rose-accent disabled:opacity-40"
                >
                  {t('sermonRemovePoint')}
                </button>
              </div>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="block text-sm font-bold text-rose-ink">
              {t('sermonFieldMediaUrl')}
            </span>
            <input
              type="url"
              value={draft.mediaUrl}
              onChange={(event) => patch({ mediaUrl: event.target.value })}
              placeholder={t('sermonMediaPlaceholder')}
              className="block w-full rounded-xl border border-rose-line bg-white px-3 py-2 text-base text-rose-ink outline-none focus:border-rose-accent"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-bold text-rose-ink">
              {t('sermonFieldPublished')}
            </legend>
            <div className="mt-1 flex gap-2">
              {[true, false].map((published) => {
                const active = draft.published === published
                return (
                  <label
                    key={String(published)}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-sm font-bold transition ${
                      active
                        ? 'border-rose-accent-deep bg-rose-accent-deep text-white'
                        : 'border-rose-line bg-white text-rose-key hover:border-rose-accent/50'
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name="sermon-published"
                      checked={active}
                      onChange={() => patch({ published })}
                    />
                    {published ? t('sermonPublishedOn') : t('sermonPublishedOff')}
                  </label>
                )
              })}
            </div>
          </fieldset>

          {error && (
            <p className="rounded-lg border border-rose-accent/40 bg-rose-bg px-3 py-2 text-sm font-bold text-rose-accent">
              {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-rose-line bg-rose-card px-4 py-3">
          {initial ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="rounded-full border border-rose-accent/40 bg-white px-3 py-2 text-sm font-bold text-rose-accent transition hover:bg-rose-accent hover:text-white disabled:opacity-40"
            >
              {t('sermonAdminDelete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full border border-rose-line bg-white px-3 py-2 text-sm font-bold text-rose-key transition hover:border-rose-accent/50 hover:text-rose-accent disabled:opacity-40"
            >
              {t('sermonCancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-rose-accent-deep px-4 py-2 text-sm font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? t('sermonSavingButton') : t('sermonSave')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
