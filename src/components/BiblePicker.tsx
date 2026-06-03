import { useEffect, useMemo, useState } from 'react'
import {
  loadBook,
  loadIndex,
  makeRef,
  parseRef,
  type BookDoc,
  type BookMeta,
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
  const [chapter, setChapter] = useState<number | ''>('')
  const [bookDoc, setBookDoc] = useState<BookDoc | null>(null)
  const [loadingBook, setLoadingBook] = useState(false)
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
          if (meta) {
            setOrder(meta.order)
            setChapter(
              parsed.chapter >= 1 && parsed.chapter <= meta.chapters
                ? parsed.chapter
                : 1,
            )
          }
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

  const chapters = useMemo(
    () => (meta ? Array.from({ length: meta.chapters }, (_, i) => i + 1) : []),
    [meta],
  )

  const selectedChapter = useMemo(() => {
    if (!bookDoc || chapter === '') return null
    return bookDoc.chapters.find((c) => c.chapter === chapter) ?? null
  }, [bookDoc, chapter])

  useEffect(() => {
    if (!meta) {
      setBookDoc(null)
      return
    }

    let alive = true
    setLoadingBook(true)
    setError(null)
    loadBook(meta.file)
      .then((doc) => {
        if (!alive) return
        setBookDoc(doc)
      })
      .catch((e) => {
        if (!alive) return
        setBookDoc(null)
        setError(String(e.message ?? e))
      })
      .finally(() => alive && setLoadingBook(false))

    return () => {
      alive = false
    }
  }, [meta])

  // 선택이 바뀌면 bibleRef 갱신 (초기화 완료 후, 사용자 변경분)
  useEffect(() => {
    if (!inited || !meta || chapter === '') return
    const ref = makeRef(meta.book, chapter as number)
    if (ref !== value) onChange(ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, chapter])

  return (
    <div className="rounded-2xl bg-rose-chip px-4 py-3">
      <label className="mb-2 block text-sm font-semibold text-rose-ink">
        오늘의 본문 (성경·장 선택)
      </label>

      <div className="flex gap-2">
        <select
          value={order}
          onChange={(e) => {
            const nextOrder = e.target.value ? Number(e.target.value) : ''
            setOrder(nextOrder)
            setChapter(nextOrder === '' ? '' : 1)
          }}
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
          disabled={!meta}
          className="w-28 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent disabled:opacity-50"
        >
          <option value="">장</option>
          {chapters.map((n) => (
            <option key={n} value={n}>
              {n}장
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {meta && chapter !== '' && (
        <div className="mt-3 rounded-xl border border-rose-line bg-white px-4 py-3">
          <p className="text-sm font-bold text-rose-accent">선택한 본문</p>
          <p className="mt-1 text-lg font-semibold text-rose-ink">
            {meta.book} {chapter}장
          </p>
          <p className="mt-1 text-xs text-rose-key/70">
            {bookDoc?.translation ?? meta.translation ?? '개역한글'}
          </p>

          {loadingBook && (
            <p className="mt-3 text-sm text-rose-key/70">본문 불러오는 중...</p>
          )}

          {!loadingBook && selectedChapter && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-rose-line bg-rose-paper px-4 py-3">
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-700">
                {selectedChapter.text}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-rose-key/70">
        위 본문을 읽고 아래에 필사하세요.
      </p>
    </div>
  )
}
