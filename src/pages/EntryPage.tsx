import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEntry } from '../hooks/useEntry'
import FieldEditor from '../components/FieldEditor'
import GuideButton from '../components/GuideButton'
import EntryShareCard, { type ShareSections } from '../components/EntryShareCard'
import TranscribeSection from '../sections/TranscribeSection'
import QuestionsSection from '../sections/QuestionsSection'
import PrayerSection from '../sections/PrayerSection'
import TemptationVictorySection from '../sections/TemptationVictorySection'
import {
  createEntryImageFile,
  shareOrDownloadEntryImage,
} from '../shareImage'
import { getVirtualKeyboard } from '../virtualKeyboard'

type Tab = 'transcribe' | 'questions' | 'prayer' | 'temptationVictory'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'transcribe', label: '필사', icon: '📖' },
  { key: 'prayer', label: '기도', icon: '🙏' },
  { key: 'questions', label: '5가지 질문', icon: '❓' },
  { key: 'temptationVictory', label: '승리', icon: '🛡️' },
]

function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  return `${y}.${m}.${d} (${dow})`
}

export default function EntryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { entry, loading, update } = useEntry(id)
  const [tab, setTab] = useState<Tab>('transcribe')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'working'>('idle')
  const [shareSections, setShareSections] = useState<ShareSections>({
    transcribe: true,
    prayer: true,
    questions: true,
    victory: true,
  })
  const shareRef = useRef<HTMLDivElement>(null)
  // 공유 카드는 평소엔 렌더하지 않는다(매 획마다 모든 획을 SVG로 다시 그려 메인스레드를
  // 막던 문제) — 공유를 누를 때만 잠깐 DOM에 올려 캡처한다.
  const [showShareCard, setShowShareCard] = useState(false)
  const canShare = Object.values(shareSections).some(Boolean)

  useEffect(() => {
    const keyboard = getVirtualKeyboard()
    if (!keyboard) return

    // Galaxy Chrome·Samsung Internet: 키보드가 viewport를 줄이며 페이지를
    // 밀어 올리지 않고 콘텐츠 위에 겹치게 한다. 활성 textarea의 위치 보정은
    // useDockedTextarea가 맡고, 미지원 브라우저는 기존 동작을 그대로 쓴다.
    const previous = keyboard.overlaysContent
    keyboard.overlaysContent = true
    return () => {
      keyboard.overlaysContent = previous
    }
  }, [])

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
      alert('이미지 파일을 만들지 못했습니다. 공유할 탭을 줄여서 다시 시도해 주세요.')
    } finally {
      setShareState('idle')
      setShowShareCard(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-rose-key/70">불러오는 중…</div>
  }
  if (!entry) {
    return (
      <div className="p-8 text-center text-rose-key">
        묵상을 찾을 수 없어요.
        <button onClick={() => navigate('/')} className="ml-2 text-rose-accent underline">
          홈으로
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-rose-line bg-rose-bg/90 px-4 py-3 backdrop-blur">
        <button
          onClick={() => navigate('/')}
          className="shrink-0 text-sm text-rose-key hover:text-rose-accent"
        >
          ← 목록
        </button>
        <h1 className="min-w-0 flex-1 truncate px-2 text-center font-serif text-lg font-bold text-rose-ink">
          {formatDate(entry.date)}
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
            {shareState === 'working' ? '생성 중…' : '공유'}
          </button>
          {shareOpen && (
            <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-rose-line bg-rose-card p-3 text-sm shadow-lg">
              <p className="mb-2 font-semibold text-rose-ink">공유할 탭</p>
              <div className="space-y-2.5">
                {[
                  ['transcribe', '필사'],
                  ['prayer', '기도'],
                  ['questions', '5가지 질문'],
                  ['victory', '승리'],
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
                JPG 공유
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 본문 */}
      <main className="flex-1 px-4 py-5">
        {tab === 'transcribe' && (
          <TranscribeSection entry={entry} update={update} FieldEditor={FieldEditor} />
        )}
        {tab === 'questions' && (
          <QuestionsSection entry={entry} update={update} FieldEditor={FieldEditor} />
        )}
        {tab === 'prayer' && (
          <PrayerSection entry={entry} update={update} FieldEditor={FieldEditor} />
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
