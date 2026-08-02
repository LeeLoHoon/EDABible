import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadIndex,
  loadBook,
  finalizeBibleChapter,
  chapterLabel,
  chapterTextAt,
  chapterUnit,
  makeRef,
  parseRefs,
  saveBibleChapterText,
  unfinalizeBibleChapter,
  type BookMeta,
  type BookDoc,
} from '../bible'
import { bookOrderByName } from '../i18n/bibleBookNames'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'

/** 본문을 이루는 한 조각. label이 있으면 그 장의 시작이다 ('14편'). */
export interface PassageChunk {
  label: string | null
  text: string
}

export interface PassageInfo {
  book: string
  chapter: number
  endChapter: number
  ref: string
  text: string
  /** text를 장 단위로 쪼갠 것 — 장 구분선 렌더용 */
  chunks: PassageChunk[]
  sourceQuality: 'verified' | 'fallback'
  loading: boolean
  canEdit: boolean
  canFinalize: boolean
  /** 완료 해제 가능 여부 — 개발자 모드에서만 노출된다 */
  canUnfinalize: boolean
  isFinalized: boolean
  saveText: (text: string) => Promise<void>
  finalize: () => Promise<void>
  unfinalize: () => Promise<void>
}

interface Props {
  /** 현재 bibleRef (예: '잠언 1~2장, 시편 1~2편') */
  value: string
  /** 책·장/편 선택 시 bibleRef 갱신 */
  onChange: (ref: string) => void
  /** 현재 본문(책·장·텍스트·로딩) 변화를 상위로 보고 — 없으면 null */
  onPassage?: (info: PassageInfo | null) => void
  /**
   * 성경 책을 한 권으로 고정한다 (index.json의 order 기준, 19 = 시편).
   * 책 칸은 읽기 전용이 되고 편(장)만 고를 수 있다.
   * null(기본)이면 66권 드롭다운 — 묵상 노트도 주일 설교 본문도 어느 권이든 고를 수 있다.
   */
  fixedBookOrder?: number | null
  /**
   * 고정하지 않을 때 새 행에 미리 채워둘 책 (order 기준).
   * null이면 '성경 선택'으로 비워 둔다.
   */
  defaultBookOrder?: number | null
}

interface Selection {
  id: string
  order: number | ''
  chapter: number | ''
  endChapter: number | ''
}

const emptySelection = (bookOrder: number | null): Selection => ({
  id: crypto.randomUUID(),
  order: bookOrder ?? '',
  chapter: '',
  endChapter: '',
})

export default function BiblePicker({
  value,
  onChange,
  onPassage,
  fixedBookOrder = null,
  defaultBookOrder = null,
}: Props) {
  // 고정된 책이 있으면 그 책, 없으면 기본 책(있을 때만) — 새 행은 모두 여기서 시작한다
  const initialBookOrder = fixedBookOrder ?? defaultBookOrder
  const [index, setIndex] = useState<BookMeta[]>([])
  const [selections, setSelections] = useState<Selection[]>(() => [emptySelection(initialBookOrder)])
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
              const order = bookOrderByName(ref.book)
              const meta = idx.find((b) => b.book === ref.book) ?? idx.find((b) => b.order === order)
              return {
                id: crypto.randomUUID(),
                order: meta?.order ?? initialBookOrder ?? '',
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
    // meta 없이 부르면 아무것도 못 읽으면서 order만 loadingOrdersRef에 점유했다 푼다.
    // 그 사이 리렌더가 끼면 missing이 비어 early return 되고, 이 effect를 다시 깨울
    // 의존성 변화가 없어 본문이 영영 로드되지 않는다 (편 셀렉트가 disabled로 고착).
    const missing = selectedOrders.filter(
      (order) =>
        metaByOrder.has(order) && !docs.has(order) && !loadingOrdersRef.current.has(order),
    )
    if (missing.length === 0) return

    missing.forEach((order) => loadingOrdersRef.current.add(order))
    Promise.all(
      missing.map(async (order) => {
        const meta = metaByOrder.get(order)!
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
            next.set(entry[0], entry[1])
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

        // 기본 책이 미리 선택돼 있으면 order 변경 이벤트가 없으므로, 끝 장은 시작 장 선택을 따라간다
        if (patch.chapter !== undefined) {
          if (next.chapter === '') next.endChapter = ''
          else if (next.endChapter === '') next.endChapter = next.chapter
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
        // 장 경계를 렌더까지 살려 보낸다 — 이어 붙인 문자열만으로는 알 수 없다
        // (절 마커가 아예 없는 장이 시편만 61개라 절 번호 리셋으로는 추론 불가)
        const chunks: PassageChunk[] = []
        const sourceQualities: Array<'verified' | 'fallback'> = []
        let isFinalized = false
        if (doc) {
          for (let current = selection.chapter; current <= selection.endChapter; current += 1) {
            const chapter = doc.chapters.find((c) => c.chapter === current)
            const text = chapter?.text ?? chapterTextAt(doc, current)
            if (text) {
              texts.push(text)
              chunks.push({ label: chapterLabel(book, current), text })
            }
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
          chunks,
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

  /* passageText와 같은 줄 시퀀스를 조각으로 쪼갠 것. 이어 붙이면 passageText와
     같은 줄들이 나오므로 PassageText의 블록 인덱스(=하이라이트 p<N> 키)가 보존된다.
     ref 줄도 본문 여러 개일 때만 넣어 순서를 그대로 맞춘다. */
  const passageChunks = useMemo(
    () =>
      selectedPassages.flatMap((passage) =>
        selectedPassages.length > 1
          ? [{ label: null, text: passage.ref }, ...passage.chunks]
          : passage.chunks,
      ),
    [selectedPassages],
  )

  const loading = selectedPassages.some((passage) => passage.loading)
  const rebuilding = inited && index.length === 0 && !error

  useEffect(() => {
    if (!inited || loading || !nextValue) return
    // 다른 언어로 저장된 참조는 현재 언어 책 이름으로 자연스럽게 다시 기록한다.
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
    const activeDoc = typeof first.order === 'number' ? docs.get(first.order) : null
    // 편집·완료·해제 모두 '단일 장을 지금 다 읽어둔 상태'를 전제로 한다
    const isSingleChapter =
      selectedPassages.length === 1 &&
      !loading &&
      typeof first.order === 'number' &&
      !!first.file &&
      first.chapter === first.endChapter
    const canEdit = isSingleChapter && !first.isFinalized && getLang() === 'ko'
    const canFinalize = canEdit && !!activeDoc?.supportsFinalize
    const canUnfinalize =
      isSingleChapter && first.isFinalized && !!activeDoc?.supportsFinalize && getLang() === 'ko'

    onPassage({
      book: first.book,
      chapter: first.chapter,
      endChapter: first.endChapter,
      ref: nextValue,
      text: passageText,
      chunks: passageChunks,
      sourceQuality: first.sourceQuality,
      loading,
      canEdit,
      canFinalize,
      canUnfinalize,
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
      unfinalize: async () => {
        if (!canUnfinalize || typeof first.order !== 'number') return
        const nextDoc = await unfinalizeBibleChapter(first.file, first.chapter)
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
    <div className="bible-picker rounded-2xl bg-rose-chip px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-sm font-semibold text-rose-ink">
          {fixedBookOrder === null ? t('pickerTitleFull') : t('pickerTitleChapter')}
        </label>
        <button
          type="button"
          onClick={() => setSelections((prev) => [...prev, emptySelection(initialBookOrder)])}
          disabled={rebuilding}
          className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-rose-accent shadow-sm"
        >
          {t('pickerAdd')}
        </button>
      </div>

      {rebuilding ? (
        <div className="rounded-xl border border-rose-line bg-white/70 px-3 py-3 text-sm leading-6 text-rose-key">
          {t('pickerRebuilding')}
        </div>
      ) : (
      <div className="space-y-2">
        {selections.map((selection, rowIndex) => {
          const meta = typeof selection.order === 'number' ? metaByOrder.get(selection.order) : null
          const count = meta?.standardChapters ?? meta?.chapters ?? 0
          const chapterOptions = Array.from({ length: count }, (_, i) => i + 1)
          const activeDoc = typeof selection.order === 'number' ? docs.get(selection.order) : null
          const unit = chapterUnit(meta?.book)

          return (
            <div
              key={selection.id}
              className="bible-picker-row"
            >
              {fixedBookOrder === null ? (
                <select
                  value={selection.order}
                  onChange={(e) =>
                    updateSelection(selection.id, {
                      order: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                  className="bible-picker-book min-w-0 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent"
                   aria-label={t('pickerBookAria')(rowIndex + 1)}
                >
                   <option value="">{t('pickerSelectBible')}</option>
                  {index.map((book) => (
                    <option key={book.order} value={book.order}>
                      {book.book}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="bible-picker-book min-w-0 truncate rounded-xl border border-rose-line bg-white/60 px-3 py-2 text-base font-medium text-rose-ink">
                  {meta?.book ?? '…'}
                </div>
              )}

              <div className="bible-picker-range">
                <select
                  value={selection.chapter}
                  onChange={(e) =>
                    updateSelection(selection.id, {
                      chapter: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                  disabled={!activeDoc}
                  className="min-w-0 rounded-xl border border-rose-line bg-white px-3 py-2 text-base font-medium text-rose-ink outline-none focus:border-rose-accent disabled:opacity-50"
                   aria-label={t('pickerStartAria')(rowIndex + 1, unit)}
                >
                   <option value="">{t('pickerStart')}</option>
                  {chapterOptions.map((n) => (
                    <option key={n} value={n}>
                       {chapterLabel(meta?.book, n)}
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
                   aria-label={t('pickerEndAria')(rowIndex + 1, unit)}
                >
                   <option value="">{t('pickerEnd')}</option>
                  {chapterOptions
                    .filter((n) => selection.chapter === '' || n >= selection.chapter)
                    .map((n) => (
                      <option key={n} value={n}>
                         {chapterLabel(meta?.book, n)}
                      </option>
                    ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelections((prev) =>
                    prev.length === 1 ? [emptySelection(initialBookOrder)] : prev.filter((item) => item.id !== selection.id),
                  )
                }
                className="bible-picker-remove flex h-10 w-10 items-center justify-center rounded-full text-xl font-bold text-rose-key transition hover:bg-white hover:text-rose-accent"
                 aria-label={t('pickerDeleteAria')(rowIndex + 1)}
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
         {t('pickerHint')}
      </p>}
    </div>
  )
}
