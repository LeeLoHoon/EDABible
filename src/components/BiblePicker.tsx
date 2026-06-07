import { useEffect, useMemo, useState } from 'react'
import {
  loadIndex,
  loadBook,
  makeRef,
  parseRef,
  type BookMeta,
  type BookDoc,
} from '../bible'

export interface PassageInfo {
  book: string
  chapter: number
  text: string
  loading: boolean
}

interface Props {
  /** 현재 bibleRef (예: '창세기 3장') */
  value: string
  /** 책·장 선택 시 bibleRef 갱신 */
  onChange: (ref: string) => void
  /** 현재 본문(책·장·텍스트·로딩) 변화를 상위로 보고 — 없으면 null */
  onPassage?: (info: PassageInfo | null) => void
}

export default function BiblePicker({ value, onChange, onPassage }: Props) {
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

  const chapterOptions = useMemo(() => {
    const count = meta?.standardChapters ?? meta?.chapters ?? 0
    return Array.from({ length: count }, (_, i) => i + 1)
  }, [meta])

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
        const maxChapter = meta.standardChapters ?? meta.chapters
        const has = wanted && wanted >= 1 && wanted <= maxChapter
        setChapter(has ? (wanted as number) : 1)
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

  const passage = useMemo(() => {
    if (!activeDoc || chapter === '') return ''
    const direct = activeDoc.chapters.find((c) => c.chapter === chapter)?.text
    if (direct) return direct

    if (activeDoc.book === '창세기' && chapter === 28) {
      return (
        activeDoc.chapters.find((c) =>
          c.text.includes('야곱은 브엘세바를 떠나 하란을 향해 갔다'),
        )?.text ?? ''
      )
    }

    return ''
  }, [activeDoc, chapter])

  // 로딩 상태는 파생: 책은 골랐지만 해당 본문이 아직 안 옴
  const loading = !!meta && !activeDoc && !error

  // 본문 데이터를 상위(TranscribeSection)로 보고 → 거기서 sticky 카드로 표시
  useEffect(() => {
    if (!onPassage) return
    if (!meta || error || (!loading && !passage)) {
      onPassage(null)
      return
    }
    onPassage({
      book: activeDoc?.book ?? meta.book,
      chapter: typeof chapter === 'number' ? chapter : 0,
      text: passage,
      loading,
    })
    // onPassage는 안정적인 setter 가정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, activeDoc, chapter, passage, loading, error])

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
          {chapterOptions.map((n) => (
            <option key={n} value={n}>
              {n}장
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      <p className="mt-2 text-xs text-rose-key/70">
        📖 메시지 성경 본문입니다. 아래 고정된 본문을 읽고 필사하세요.
      </p>
    </div>
  )
}
