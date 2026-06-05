import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GuideButton from '../components/GuideButton'
import { listEntries, putEntry, deleteEntry, clearAllEntries } from '../db'
import { createEntry, emptyTemptationVictory, isFieldEmpty, type Entry } from '../types'

function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[new Date(Number(y), Number(m) - 1, Number(d)).getDay()]
  return `${Number(m)}월 ${Number(d)}일 (${dow})`
}

/** 작성 진행 칸 수 / 전체 칸 수 */
function progress(e: Entry): { done: number; total: number } {
  const worksheet = {
    ...emptyTemptationVictory(),
    ...(e.temptationVictory ?? {}),
  }
  const fields = [
    e.transcription,
    ...e.answers,
    e.spousePrayer,
    ...e.prayerTopics,
    worksheet.sin,
    worksheet.stageNote,
    worksheet.help,
    worksheet.pray,
    worksheet.victory,
    worksheet.grow,
  ]
  return { done: fields.filter((f) => !isFieldEmpty(f)).length, total: fields.length }
}

export default function HomePage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const recordsRef = useRef<HTMLDivElement>(null)

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

  const removeAll = async () => {
    if (
      !confirm(
        `모든 묵상 ${entries.length}편을 삭제할까요?\n되돌릴 수 없으며, 필사·기도·기록이 모두 사라집니다.`,
      )
    )
      return
    await clearAllEntries()
    setEntries([])
  }

  return (
    <div className="relative mx-auto max-w-2xl">
      <GuideButton className="absolute right-4 top-4 z-10" />
      {/* 책 표지 — 첫 페이지 */}
      <section className="relative flex min-h-[86vh] flex-col items-center justify-center px-6 text-center">
        {/* 표지 프레임 (책 테두리) */}
        <div className="pointer-events-none absolute inset-x-4 inset-y-4 rounded-[28px] border border-rose-line" />
        <div className="pointer-events-none absolute inset-x-[22px] inset-y-[26px] rounded-[22px] border border-rose-line/50" />

        <p className="font-serif text-[13px] tracking-[0.45em] text-rose-key">DAILY&nbsp;DEVOTION</p>

        <div className="my-7 flex items-center gap-3 text-rose-accent/70">
          <span className="h-px w-10 bg-rose-line" />
          <span className="text-lg">✦</span>
          <span className="h-px w-10 bg-rose-line" />
        </div>

        <h1 className="font-serif text-[2.75rem] font-extrabold leading-[1.15] tracking-tight text-rose-ink">
          말씀
          <br />
          묵상 노트
        </h1>
        <p className="mt-4 font-serif text-base tracking-wide text-rose-key">EDABible</p>

        <blockquote className="mt-10 max-w-xs font-serif text-[15px] leading-7 text-rose-ink/80">
          “주의 말씀은 내 발에 등이요
          <br />내 길에 빛이니이다”
          <footer className="mt-2.5 text-sm text-rose-key">— 시편 119:105</footer>
        </blockquote>

        <button
          type="button"
          onClick={() => recordsRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute inset-x-0 bottom-7 mx-auto flex flex-col items-center gap-1 text-rose-key/70 transition active:scale-95"
        >
          <span className="font-serif text-xs tracking-[0.25em]">묵상 기록 보기</span>
          <span className="animate-bounce text-base leading-none">⌄</span>
        </button>
      </section>

      {/* 묵상 기록 — 목차 */}
      <div ref={recordsRef} className="scroll-mt-4 px-4 pb-28 pt-2">
        <header className="mb-5 flex items-center gap-3">
          <h2 className="font-serif text-xl font-bold text-rose-ink">묵상 기록</h2>
          {!loading && entries.length > 0 && (
            <span className="text-sm text-rose-key">총 {entries.length}편</span>
          )}
          <span className="h-px flex-1 bg-rose-line" />
          {!loading && entries.length > 0 && (
            <button
              type="button"
              onClick={removeAll}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-rose-chip hover:text-rose-accent"
            >
              전체 삭제
            </button>
          )}
        </header>

        {loading ? (
          <p className="py-12 text-center text-zinc-400">불러오는 중…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-line bg-rose-card/60 py-16 text-center">
            <p className="text-zinc-500">아직 묵상 기록이 없어요.</p>
            <p className="mt-1 text-sm text-zinc-400">아래 버튼으로 오늘의 묵상을 시작해보세요.</p>
          </div>
        ) : (
          <ul className="space-y-3">
          {entries.map((e) => {
            const p = progress(e)
            return (
              <li
                key={e.id}
                onClick={() => navigate(`/entry/${e.id}`)}
                className="group flex cursor-pointer items-center justify-between rounded-2xl border border-rose-line bg-rose-card px-4 py-3.5 shadow-sm transition hover:border-rose-accent"
              >
                <div className="min-w-0">
                  <p className="font-serif text-[17px] font-bold text-rose-ink">{formatDate(e.date)}</p>
                  <p className="truncate text-sm text-rose-key">
                    {e.bibleRef || '본문 미입력'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-medium text-rose-ink">
                    {p.done}/{p.total}
                  </span>
                  <button
                    onClick={(ev) => remove(e.id, ev)}
                    className="-mr-2 flex h-12 w-12 items-center justify-center rounded-full text-2xl text-zinc-300 hover:bg-rose-chip hover:text-rose-accent"
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

        <footer className="mt-10 text-center text-[11px] leading-relaxed text-rose-key/60">
          <p>© {new Date().getFullYear()} EDABible</p>
          <p className="mt-0.5 font-mono">v{__BUILD__}</p>
        </footer>
      </div>

      {/* 새 묵상 시작 (플로팅) */}
      <button
        onClick={startNew}
        className="safe-pad fixed inset-x-0 bottom-0 mx-auto flex max-w-2xl items-center justify-center"
      >
        <span className="mb-5 w-[calc(100%-2rem)] rounded-2xl bg-rose-accent py-4 text-center text-lg font-bold text-white shadow-lg shadow-rose-accent/30 active:scale-[0.99]">
          ✏️ 오늘 묵상 시작
        </span>
      </button>
    </div>
  )
}
