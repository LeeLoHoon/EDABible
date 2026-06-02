import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEntry } from '../hooks/useEntry'
import FieldEditor from '../components/FieldEditor'
import TranscribeSection from '../sections/TranscribeSection'
import QuestionsSection from '../sections/QuestionsSection'
import PrayerSection from '../sections/PrayerSection'

type Tab = 'transcribe' | 'questions' | 'prayer'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'transcribe', label: '필사', icon: '📖' },
  { key: 'questions', label: '5가지 질문', icon: '❓' },
  { key: 'prayer', label: '기도', icon: '🙏' },
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
  const { entry, loading, saveState, update } = useEntry(id)
  const [tab, setTab] = useState<Tab>('transcribe')

  if (loading) {
    return <div className="p-8 text-center text-zinc-400">불러오는 중…</div>
  }
  if (!entry) {
    return (
      <div className="p-8 text-center text-zinc-500">
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
          className="text-sm text-zinc-500 hover:text-rose-accent"
        >
          ← 목록
        </button>
        <h1 className="text-lg font-bold text-rose-ink">
          {formatDate(entry.date)}
          {entry.bibleRef && (
            <span className="ml-2 font-medium text-rose-key">· {entry.bibleRef}</span>
          )}
        </h1>
        <span className="w-12 text-right text-xs text-zinc-400">
          {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? '저장됨' : ''}
        </span>
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
      </main>

      {/* 하단 탭바 */}
      <nav className="safe-pad sticky bottom-0 z-10 grid grid-cols-3 border-t border-rose-line bg-rose-card">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'text-rose-accent' : 'text-zinc-400'
            }`}
          >
            <span className="text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
