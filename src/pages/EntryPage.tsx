import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

/** 묵상 노트 홈 경로 — 통합(all) 배포는 /note, 단독 배포는 앱 루트 */
const NOTE_HOME_PATH = __APP_TARGET__ === 'all' ? '/note' : '/'
import { enableBibleCopy } from '../bibleCopy'
import { useEntry } from '../hooks/useEntry'
import FieldEditor from '../components/FieldEditor'
import GuideButton from '../components/GuideButton'
import EntryShareCard, { type ShareSections } from '../components/EntryShareCard'
import BiblePicker, { type PassageInfo } from '../components/BiblePicker'
import MeditationSection from '../sections/MeditationSection'
import TranscribeSection from '../sections/TranscribeSection'
import QuestionsSection from '../sections/QuestionsSection'
import TemptationVictorySection from '../sections/TemptationVictorySection'
import {
  createEntryImageFile,
  shareOrDownloadEntryImage,
} from '../shareImage'
import { formatEntryDateDot } from '../i18n/format'
import { t } from '../i18n/strings'

type Tab = 'meditation' | 'transcribe' | 'questions' | 'temptationVictory'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'meditation', label: t('entryTabs')[0], icon: '📖' },
  { key: 'transcribe', label: t('entryTabs')[1], icon: '✍️' },
  { key: 'questions', label: t('entryTabs')[2], icon: '❓' },
  { key: 'temptationVictory', label: t('entryTabs')[3], icon: '🛡️' },
]

const DEV_COPY_TAP_COUNT = 5
const DEV_COPY_TAP_WINDOW_MS = 2_000

export default function EntryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { entry, loading, update } = useEntry(id)
  const [tab, setTab] = useState<Tab>('meditation')
  const [passage, setPassage] = useState<PassageInfo | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'working'>('idle')
  const [shareSections, setShareSections] = useState<ShareSections>({
    transcribe: true,
    prayer: true,
    questions: true,
    victory: true,
  })
  const copyTapRef = useRef({ count: 0, deadline: 0 })
  const shareRef = useRef<HTMLDivElement>(null)
  // 공유 카드는 평소엔 렌더하지 않는다(매 획마다 모든 획을 SVG로 다시 그려 메인스레드를
  // 막던 문제) — 공유를 누를 때만 잠깐 DOM에 올려 캡처한다.
  const [showShareCard, setShowShareCard] = useState(false)
  const canShare = Object.values(shareSections).some(Boolean)

  const handleDateTap = () => {
    const now = performance.now()
    const taps = copyTapRef.current
    if (now > taps.deadline) {
      taps.count = 1
      taps.deadline = now + DEV_COPY_TAP_WINDOW_MS
      return
    }

    taps.count += 1
    if (taps.count < DEV_COPY_TAP_COUNT) return
    taps.count = 0
    taps.deadline = 0
    enableBibleCopy()
    navigator.vibrate?.(40)
  }

  const shareEntry = async () => {
    if (!entry || shareState === 'working' || !canShare) return
    setShareOpen(false)
    setShareState('working')
    setShowShareCard(true)
    try {
      // 공유 카드가 DOM에 그려질 때까지 한두 프레임 대기
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
      if (!shareRef.current) throw new Error('share card not ready')
      const file = await createEntryImageFile(shareRef.current, entry)
      await shareOrDownloadEntryImage(file, entry)
    } catch (error) {
      console.error(error)
      alert(t('entryImageFailed'))
    } finally {
      setShareState('idle')
      setShowShareCard(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-rose-key/70">{t('entryLoading')}</div>
  }
  if (!entry) {
    return (
      <div className="p-8 text-center text-rose-key">
        {t('entryNotFound')}
        <button onClick={() => navigate(NOTE_HOME_PATH)} className="ml-2 text-rose-accent underline">
          {t('entryHome')}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-rose-line bg-rose-bg/90 px-4 py-3 backdrop-blur">
        <button
          onClick={() => navigate(NOTE_HOME_PATH)}
          className="shrink-0 text-sm text-rose-key hover:text-rose-accent"
        >
          {t('entryBack')}
        </button>
        <h1
          onClick={handleDateTap}
          className="min-w-0 flex-1 truncate px-2 text-center font-serif text-lg font-bold text-rose-ink"
        >
          {formatEntryDateDot(entry.date)}
          {entry.bibleRef && (
            <span className="ml-2 font-medium text-rose-key">· {entry.bibleRef}</span>
          )}
        </h1>
        <div className="relative flex shrink-0 items-center gap-2">
          <GuideButton />
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            disabled={shareState === 'working'}
            className="flex items-center gap-1.5 rounded-full bg-rose-accent-deep px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95 disabled:opacity-60"
          >
            <span aria-hidden>📤</span>
            {shareState === 'working' ? t('entryGenerating') : t('entryShare')}
          </button>
          {shareOpen && (
            <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-rose-line bg-rose-card p-3 text-sm shadow-lg">
              <p className="mb-2 font-semibold text-rose-ink">{t('entryShareTabs')}</p>
              <div className="space-y-2.5">
                {[
                  ['transcribe', t('shareTranscribe')],
                  ['prayer', t('sharePrayer')],
                  ['questions', t('shareQuestions')],
                  ['victory', t('shareVictory')],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-rose-ink">
                    <input
                      type="checkbox"
                      checked={shareSections[key as keyof ShareSections]}
                      onChange={(e) =>
                        setShareSections((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-rose-accent-deep"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={shareEntry}
                disabled={!canShare || shareState === 'working'}
                className="mt-3 w-full rounded-full bg-rose-accent-deep px-3 py-2 font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
              >
                {t('entryJpgShare')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 본문 */}
      <main className="flex-1 px-4 py-5">
        {/* 탭을 옮겨도 본문을 다시 받아오지 않도록 마운트는 유지하고 보이기만 감춘다 */}
        <div className={tab === 'meditation' ? 'mb-4' : 'hidden'}>
          <BiblePicker
            value={entry.bibleRef}
            onChange={(bibleRef) => update({ bibleRef })}
            onPassage={setPassage}
          />
        </div>
        {tab === 'meditation' && (
          <MeditationSection
            entry={entry}
            passage={passage}
            setPassage={setPassage}
            update={update}
            FieldEditor={FieldEditor}
          />
        )}
        {tab === 'transcribe' && (
          <TranscribeSection
            entry={entry}
            passage={passage}
            update={update}
            FieldEditor={FieldEditor}
          />
        )}
        {tab === 'questions' && (
          <QuestionsSection entry={entry} update={update} FieldEditor={FieldEditor} />
        )}
        {tab === 'temptationVictory' && (
          <TemptationVictorySection entry={entry} update={update} FieldEditor={FieldEditor} />
        )}
      </main>

      {/* 하단 탭바 */}
      <nav className="safe-pad sticky bottom-0 z-10 grid grid-cols-4 border-t border-rose-line bg-rose-card">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'text-rose-accent' : 'text-rose-key/70'
            }`}
          >
            <span className="text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {showShareCard && (
        <div className="pointer-events-none fixed -left-[10000px] top-0">
          <div ref={shareRef}>
            <EntryShareCard entry={entry} sections={shareSections} />
          </div>
        </div>
      )}
    </div>
  )
}
