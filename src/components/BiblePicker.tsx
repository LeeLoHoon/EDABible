import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadIndex,
  loadBook,
  finalizeBibleChapter,
  makeRef,
  parseRefs,
  saveBibleChapterText,
  type BookMeta,
  type BookDoc,
} from '../bible'

export interface PassageInfo {
  book: string
  chapter: number
  endChapter: number
  ref: string
  text: string
  sourceQuality: 'verified' | 'fallback'
  loading: boolean
  canEdit: boolean
  canFinalize: boolean
  isFinalized: boolean
  saveText: (text: string) => Promise<void>
  finalize: () => Promise<void>
}

interface Props {
  /** 현재 bibleRef (예: '잠언 1~2장, 전도서 1~2장') */
  value: string
  /** 책·장 선택 시 bibleRef 갱신 */
  onChange: (ref: string) => void
  /** 현재 본문(책·장·텍스트·로딩) 변화를 상위로 보고 — 없으면 null */
  onPassage?: (info: PassageInfo | null) => void
}

interface Selection {
  id: string
  order: number | ''
  chapter: number | ''
  endChapter: number | ''
}

const emptySelection = (): Selection => ({
  id: crypto.randomUUID(),
  order: '',
  chapter: '',
  endChapter: '',
})

function chapterText(doc: BookDoc, chapter: number): string {
  const direct = doc.chapters.find((c) => c.chapter === chapter)?.text
  if (direct) return direct

  if (doc.book === '창세기' && chapter === 28) {
    return (
      doc.chapters.find((c) =>
        c.text.includes('야곱은 브엘세바를 떠나 하란을 향해 갔다'),
      )?.text ?? ''
    )
  }

  return ''
}

export default function BiblePicker({ value, onChange, onPassage }: Props) {
  const [index, setIndex] = useState<BookMeta[]>([])
  const [selections, setSelections] = useState<Selection[]>([emptySelection()])
  const [docs, setDocs] = useState<Map<number, BookDoc>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [inited, setInited] = useState(false)
  const loadingOrdersRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    loadIndex()
      .then((idx) => {
        if (!alive) return
        setIndex(idx)
        const parsed = parseRefs(value)
        if (parsed.length > 0) {
          setSelections(
            parsed.map((ref) => {
              const meta = idx.find((b) => b.book === ref.book)
              return {
                id: crypto.randomUUID(),
                order: meta?.order ?? '',
                chapter: ref.chapter,
                endChapter: ref.endChapter,
              }
            }),
          )
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

  const metaByOrder = useMemo(() => new Map(index.map((meta) => [meta.order, meta])), [index])

  const selectedOrders = useMemo(
    () =>
      Array.from(
        new Set(
          selections
            .map((selection) => selection.order)
            .filter((order): order is number => typeof order === 'number'),
        ),
      ),
    [selections],
  )

  useEffect(() => {
    let alive = true
    const missing = selectedOrders.filter(
      (order) => !docs.has(order) && !loadingOrdersRef.current.has(order),
    )
    if (missing.length === 0) return

    missing.forEach((order) => loadingOrdersRef.current.add(order))
    Promise.all(
      missing.map(async (order) => {
        const meta = metaByOrder.get(order)
        if (!meta) return null
        const doc = await loadBook(meta.file)
        return [order, doc] as const
      }),
    )
      .then((entries) => {
        if (!alive) return
        setError(null)
        setDocs((prev) => {
          const next = new Map(prev)
          for (const entry of entries) {
            if (entry) next.set(entry[0], entry[1])
          }
          return next
        })
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => {
        missing.forEach((order) => loadingOrdersRef.current.delete(order))
      })

    return () => {
      alive = false
    }
  }, [docs, metaByOrder, selectedOrders])

  const updateSelection = (id: string, patch: Partial<Selection>) => {
    setSelections((prev) =>
      prev.map((selection) => {
        if (selection.id !== id) return selection
        const next = { ...selection, ...patch }
        const meta = typeof next.order === 'number' ? metaByOrder.get(next.order) : null
        const maxChapter = meta ? meta.standardChapters ?? meta.chapters : 0

        if (patch.order !== undefined) {
          next.chapter = next.order === '' ? '' : 1
          next.endChapter = next.order === '' ? '' : 1
        }

        if (typeof next.chapter === 'number' && maxChapter > 0) {
          next.chapter = Math.min(Math.max(next.chapter, 1), maxChapter)
        }

        if (typeof next.chapter === 'number' && typeof next.endChapter === 'number') {
          next.endChapter = Math.min(Math.max(next.endChapter, next.chapter), maxChapter)
        }

        return next
      }),
    )
  }

  const selectedPassages = useMemo(() => {
    return selections
      .map((selection) => {
        if (
          typeof selection.order !== 'number' ||
          typeof selection.chapter !== 'number' ||
          typeof selection.endChapter !== 'number'
        ) {
          return null
        }

        const doc = docs.get(selection.order)
        const meta = metaByOrder.get(selection.order)
        const book = doc?.book ?? meta?.book
        if (!book) return null

        const ref = makeRef(book, selection.chapter, selection.endChapter)
        const texts: string[] = []
        const sourceQualities: Array<'verified' | 'fallback'> = []
        let isFinalized = false
        if (doc) {
          for (let current = selection.chapter; current <= selection.endChapter; current += 1) {
            const chapter = doc.chapters.find((c) => c.chapter === current)
            const text = chapter?.text ?? chapterText(doc, current)
            if (text) texts.push(text)
            sourceQualities.push(chapter?.sourceQuality === 'verified' ? 'verified' : 'fallback')
            if (chapter?.isFinalized) isFinalized = true
          }
        }
        const sourceQuality: 'verified' | 'fallback' = sourceQualities.every(
          (quality) => quality === 'verified',
        )
          ? 'verified'
          : 'fallback'

        return {
          order: selection.order,
          file: meta?.file ?? '',
          ref,
          book,
          chapter: selection.chapter,
          endChapter: selection.endChapter,
          text: texts.join('\n\n'),
          sourceQuality,
          loading: !doc,
          isFinalized,
        }
      })
      .filter((passage): passage is NonNullable<typeof passage> => !!passage)
  }, [docs, metaByOrder, selections])

  const nextValue = useMemo(
    () => selectedPassages.map((passage) => passage.ref).join(', '),
    [selectedPassages],
  )

  const passageText = useMemo(
    () =>
      selectedPassages
        .map((passage) => [selectedPassages.length > 1 ? passage.ref : '', passage.text].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n\n'),
    [selectedPassages],
  )

  const loading = selectedPassages.some((passage) => passage.loading)
  const rebuilding = inited && index.length === 0 && !error

  useEffect(() => {
    if (!inited || loading || !nextValue) return
    if (nextValue !== value) onChange(nextValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inited, loading, nextValue])

  useEffect(() => {
    if (!onPassage) return
    if (error || selectedPassages.length === 0 || (!loading && !passageText)) {
      onPassage(null)
      return
    }

    const first = selectedPassages[0]
    const canEdit =
      selectedPassages.length === 1 &&
      !loading &&
      typeof first.order === 'number' &&
      !!first.file &&
      first.chapter === first.endChapter &&
      !first.isFinalized
    const activeDoc = typeof first.order === 'number' ? docs.get(first.order) : null
    const canFinalize = canEdit && !!activeDoc?.supportsFinalize

    onPassage({
      book: first.book,
      chapter: first.chapter,
      endChapter: first.endChapter,
      ref: nextValue,
      text: passageText,
      sourceQuality: first.sourceQuality,
      loading,
      canEdit,
      canFinalize,
      isFinalized: first.isFinalized,
      saveText: async (text: string) => {
        if (!canEdit || typeof first.order !== 'number') return
        const nextDoc = await saveBibleChapterText(first.file, first.chapter, text)
        setDocs((prev) => {
          const next = new Map(prev)
          next.set(first.order, nextDoc)
          return next
        })
      },
      finalize: async () => {
        if (!canFinalize || typeof first.order !== 'number') return
        const nextDoc = await finalizeBibleChapter(first.file, first.chapter)
        setDocs((prev) => {
          const next = new Map(prev)
          next.set(first.order, nextDoc)
          return next
        })
      },
    })
    // onPassage는 안정적인 setter 가정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, loading, nextValue, passageText, selectedPassages])

  return (
    <div className="rounded-2xl bg-rose-chip px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-sm font-semibold text-rose-ink">
          오늘의 본문 (성경·장 선택)
        </label>
        <button
          type="button"
          onClick={() => setSelections((prev) => [...prev, emptySelection()])}
          disabled={rebuilding}
          className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-rose-accent shadow-sm"
        >
          + 본문 추가
        </button>
      </div>

      {rebuilding ? (
        <div className="rounded-xl border border-rose-line bg-white/70 px-3 py-3 text-sm leading-6 text-rose-key">
          성경 본문을 원본 스캔 기준으로 다시 만드는 중입니다.
        </div>
      ) : (
      <div className="space-y-2">
        {selections.map((selection, rowIndex) => {
          const meta = typeof selection.order === 'number' ? metaByOrder.get(selection.order) : null
          const count = meta?.standardChapters ?? meta?.chapters ?? 0
          const chapterOptions = Array.from({ length: count }, (_, i) => i + 1)
          const activeDoc = typeof selection.order === 'number' ? docs.get(selection.order) : null

          return (
            <div
              key={selection.id}
              className="grid grid-cols-[minmax(0,1fr)_5.75rem_auto_5.75rem_auto] items-center gap-2"
            >
              <select
                value={selection.order}
                onChange={(e) =>
                  updateSelection(selection.id, {
                    order: e.target.value ? Number(e.target.value) : '',
                  })
                }
                className="min-w-0 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent"
                aria-label={`본문 ${rowIndex + 1} 성경`}
              >
                <option value="">성경 선택</option>
                {index.map((book) => (
                  <option key={book.order} value={book.order}>
                    {book.book}
                  </option>
                ))}
              </select>

              <select
                value={selection.chapter}
                onChange={(e) =>
                  updateSelection(selection.id, {
                    chapter: e.target.value ? Number(e.target.value) : '',
                  })
                }
                disabled={!activeDoc}
                className="min-w-0 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent disabled:opacity-50"
                aria-label={`본문 ${rowIndex + 1} 시작 장`}
              >
                <option value="">시작</option>
                {chapterOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}장
                  </option>
                ))}
              </select>

              <span className="text-center text-sm font-semibold text-rose-key">~</span>

              <select
                value={selection.endChapter}
                onChange={(e) =>
                  updateSelection(selection.id, {
                    endChapter: e.target.value ? Number(e.target.value) : '',
                  })
                }
                disabled={!activeDoc || selection.chapter === ''}
                className="min-w-0 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent disabled:opacity-50"
                aria-label={`본문 ${rowIndex + 1} 끝 장`}
              >
                <option value="">끝</option>
                {chapterOptions
                  .filter((n) => selection.chapter === '' || n >= selection.chapter)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}장
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  setSelections((prev) =>
                    prev.length === 1 ? [emptySelection()] : prev.filter((item) => item.id !== selection.id),
                  )
                }
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-bold text-rose-key transition hover:bg-white hover:text-rose-accent"
                aria-label={`본문 ${rowIndex + 1} 삭제`}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {!rebuilding && <p className="mt-2 text-xs text-rose-key/70">
        📖 여러 본문을 추가해 함께 읽고 필사할 수 있습니다.
      </p>}
    </div>
  )
}
