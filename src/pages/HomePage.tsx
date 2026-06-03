import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listEntries, putEntry, deleteEntry } from '../db'
import { createEntry, isFieldEmpty, type Entry } from '../types'

function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  return `${Number(m)}월 ${Number(d)}일 (${dow})`
}

/** 작성 진행 칸 수 / 전체 칸 수 */
function progress(e: Entry): { done: number; total: number } {
  const fields = [e.transcription, ...e.answers, e.spousePrayer, ...e.prayerTopics]
  return { done: fields.filter((f) => !isFieldEmpty(f)).length, total: fields.length }
}

export default function HomePage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listEntries().then((e) => {
      setEntries(e)
      setLoading(false)
    })
  }, [])

  const startNew = async () => {
    const entry = createEntry(new Date())
    await putEntry(entry)
    navigate(`/entry/${entry.id}`)
  }

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('이 묵상을 삭제할까요?')) return
    await deleteEntry(id)
    setEntries((prev) => prev.filter((x) => x.id !== id))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-7">
      <header className="mb-7 border-b border-rose-line/70 pb-5">
        <h1 className="text-3xl font-extrabold tracking-tight text-rose-ink">EDABible</h1>
        <p className="mt-1 text-sm font-medium text-rose-key/75">매일의 말씀 묵상과 필사</p>
      </header>

      {loading ? (
        <p className="py-12 text-center text-zinc-400">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rose-line bg-rose-card/80 py-16 text-center shadow-sm shadow-rose-ink/10">
          <p className="font-medium text-rose-key/80">아직 묵상 기록이 없어요.</p>
          <p className="mt-1 text-sm text-rose-key/55">아래 버튼으로 오늘의 묵상을 시작해보세요.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            const p = progress(e)
            return (
              <li
                key={e.id}
                onClick={() => navigate(`/entry/${e.id}`)}
                className="group flex cursor-pointer items-center justify-between rounded-2xl border border-rose-line bg-rose-card px-4 py-3.5 shadow-md shadow-rose-ink/10 transition hover:border-rose-accent hover:bg-[#fffaf1]"
              >
                <div className="min-w-0">
                  <p className="font-bold text-rose-ink">{formatDate(e.date)}</p>
                  <p className="truncate text-sm font-medium text-rose-key/80">
                    {e.bibleRef || '본문 미입력'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-semibold text-rose-ink shadow-inner">
                    {p.done}/{p.total}
                  </span>
                  <button
                    onClick={(ev) => remove(e.id, ev)}
                    className="text-sm text-rose-key/35 hover:text-rose-accent"
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 새 묵상 시작 (플로팅) */}
      <button
        onClick={startNew}
        className="safe-pad fixed inset-x-0 bottom-0 mx-auto flex max-w-2xl items-center justify-center"
      >
        <span className="mb-5 w-[calc(100%-2rem)] rounded-2xl bg-rose-accent py-4 text-center text-lg font-bold text-[#fff8ed] shadow-xl shadow-rose-ink/25 ring-1 ring-black/10 active:scale-[0.99]">
          ✏️ 오늘 묵상 시작
        </span>
      </button>
    </div>
  )
}
