import { useEffect, useMemo, useState } from 'react'
import {
  loadIndex,
  loadBook,
  makeRef,
  parseRef,
  type BookMeta,
  type BookDoc,
} from '../bible'

interface Props {
  /** 현재 bibleRef (예: '창세기 3장') */
  value: string
  /** 책·장 선택 시 bibleRef 갱신 */
  onChange: (ref: string) => void
}

export default function BiblePicker({ value, onChange }: Props) {
  const [index, setIndex] = useState<BookMeta[]>([])
  const [order, setOrder] = useState<number | ''>('')
  const [doc, setDoc] = useState<BookDoc | null>(null)
  const [chapter, setChapter] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [inited, setInited] = useState(false)

  // 목록 로드 + 기존 bibleRef로 초기 선택
  useEffect(() => {
    let alive = true
    loadIndex()
      .then((idx) => {
        if (!alive) return
        setIndex(idx)
        const parsed = parseRef(value)
        if (parsed) {
          const meta = idx.find((b) => b.book === parsed.book)
          if (meta) setOrder(meta.order)
        }
        setInited(true)
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
    // value는 최초 1회만 반영 (이후 사용자 선택 우선)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const meta = useMemo(
    () => index.find((b) => b.order === order) ?? null,
    [index, order],
  )

  // 책 선택 → 본문 로드
  useEffect(() => {
    if (!meta) return
    let alive = true
    loadBook(meta.file)
      .then((d) => {
        if (!alive) return
        setError(null)
        setDoc(d)
        const parsed = parseRef(value)
        const wanted =
          parsed && parsed.book === d.book ? parsed.chapter : undefined
        const has = wanted && d.chapters.some((c) => c.chapter === wanted)
        setChapter(has ? (wanted as number) : (d.chapters[0]?.chapter ?? ''))
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
    // meta 변경시에만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta])

  // 선택한 책과 실제 로드된 본문이 일치할 때만 사용 (전환 중 옛 데이터 방지)
  const activeDoc = meta && doc?.order === meta.order ? doc : null

  // 선택이 바뀌면 bibleRef 갱신 (초기화 완료 후, 사용자 변경분)
  useEffect(() => {
    if (!inited || !activeDoc || chapter === '') return
    const ref = makeRef(activeDoc.book, chapter as number)
    if (ref !== value) onChange(ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, chapter])

  const passage = useMemo(
    () => activeDoc?.chapters.find((c) => c.chapter === chapter)?.text ?? '',
    [activeDoc, chapter],
  )

  // 로딩 상태는 파생: 책은 골랐지만 해당 본문이 아직 안 옴
  const loading = !!meta && !activeDoc && !error

  return (
    <div className="rounded-2xl bg-rose-chip px-4 py-3">
      <label className="mb-2 block text-sm font-semibold text-rose-ink">
        오늘의 본문 (성경·장 선택)
      </label>

      <div className="flex gap-2">
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value ? Number(e.target.value) : '')}
          className="min-w-0 flex-1 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent"
        >
          <option value="">성경 선택</option>
          {index.map((b) => (
            <option key={b.order} value={b.order}>
              {b.book}
            </option>
          ))}
        </select>

        <select
          value={chapter}
          onChange={(e) => setChapter(e.target.value ? Number(e.target.value) : '')}
          disabled={!activeDoc}
          className="w-28 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent disabled:opacity-50"
        >
          <option value="">장</option>
          {activeDoc?.chapters.map((c) => (
            <option key={c.chapter} value={c.chapter}>
              {c.chapter}장
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {/* 선택한 본문 표시 (읽으며 필사) */}
      {loading && <p className="mt-3 text-sm text-rose-key/70">본문 불러오는 중…</p>}
      {!loading && passage && (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-rose-line bg-white px-4 py-3">
          <p className="mb-1 text-sm font-bold text-rose-accent">
            {activeDoc?.book} {chapter}장
          </p>
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-700">
            {passage}
          </p>
        </div>
      )}

      <p className="mt-2 text-xs text-rose-key/70">
        📖 메시지 성경 본문입니다. 위 본문을 읽고 아래에 필사하세요.
      </p>
    </div>
  )
}
