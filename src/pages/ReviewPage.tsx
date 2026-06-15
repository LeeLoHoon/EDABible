import { useEffect, useMemo, useState } from 'react'

interface ReviewSource {
  pdf: string
  page: number
  q: number
  box: number[]
  image: string
}

interface ReviewItem {
  id: string
  book: string
  chapter: number
  line: number
  reasons: string[]
  before: string
  original: string
  suggested: string
  after: string
  source: ReviewSource | null
  image: string
}

interface ReviewData {
  total: number
  copiedImages: number
  items: ReviewItem[]
}

type Decision = 'pending' | 'replace' | 'delete' | 'keep'

interface ReviewEdit {
  decision: Decision
  confirm: string
  note: string
}

const BASE = import.meta.env.BASE_URL
const STORAGE_KEY = 'eda-scan-review-edits-v1'

function emptyEdit(item: ReviewItem): ReviewEdit {
  return { decision: 'pending', confirm: item.suggested || item.original, note: '' }
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [edits, setEdits] = useState<Record<string, ReviewEdit>>({})
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    fetch(`${BASE}review/scan-review.json?v=${__BUILD__}`)
      .then((res) => {
        if (!res.ok) throw new Error('검수 목록을 불러오지 못했습니다')
        return res.json()
      })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)))

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setEdits(JSON.parse(raw))
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits))
  }, [edits])

  const items = data?.items ?? []
  const visibleItems = useMemo(
    () => (showDone ? items : items.filter((item) => (edits[item.id]?.decision ?? 'pending') === 'pending')),
    [edits, items, showDone],
  )
  const current = visibleItems[Math.min(index, Math.max(visibleItems.length - 1, 0))]
  const currentEdit = current ? (edits[current.id] ?? emptyEdit(current)) : null
  const done = items.filter((item) => (edits[item.id]?.decision ?? 'pending') !== 'pending').length

  useEffect(() => {
    if (index >= visibleItems.length) setIndex(Math.max(visibleItems.length - 1, 0))
  }, [index, visibleItems.length])

  const updateCurrent = (patch: Partial<ReviewEdit>) => {
    if (!current) return
    setEdits((prev) => ({
      ...prev,
      [current.id]: { ...(prev[current.id] ?? emptyEdit(current)), ...patch },
    }))
  }

  const decide = (decision: Decision, confirm?: string) => {
    if (!current) return
    updateCurrent({ decision, confirm: confirm ?? currentEdit?.confirm ?? '' })
    setIndex((value) => Math.min(value, Math.max(visibleItems.length - 2, 0)))
  }

  const exportResult = () => {
    const rows = items.map((item) => ({
      ...item,
      review: edits[item.id] ?? emptyEdit(item),
    }))
    downloadJson(`eda-scan-review-${new Date().toISOString().slice(0, 10)}.json`, {
      build: __BUILD__,
      exportedAt: new Date().toISOString(),
      total: rows.length,
      completed: done,
      items: rows,
    })
  }

  const importResult = async (file: File) => {
    const parsed = JSON.parse(await file.text())
    const next: Record<string, ReviewEdit> = {}
    for (const item of parsed.items ?? []) {
      if (item.id && item.review) next[item.id] = item.review
    }
    setEdits(next)
  }

  if (error) {
    return <main className="review-shell"><p className="review-error">{error}</p></main>
  }

  if (!data) {
    return (
      <main className="review-shell">
        <p className="review-loading">검수 목록을 불러오는 중입니다.</p>
      </main>
    )
  }

  if (!current || !currentEdit) {
    return (
      <main className="review-shell">
        <header className="review-topbar">
          <div>
            <h1>본문 OCR 검수</h1>
            <p>
              {done}/{items.length} 완료 · 표시 {visibleItems.length}건 · 이미지 {data.copiedImages}개
            </p>
          </div>
          <div className="review-actions">
            <button type="button" onClick={() => setShowDone(true)}>완료 포함</button>
            <button type="button" onClick={exportResult}>내보내기</button>
          </div>
        </header>
        <section className="review-progress" aria-label="검수 진행률">
          <span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </section>
        <p className="review-loading">검수할 항목이 없습니다.</p>
      </main>
    )
  }

  return (
    <main className="review-shell selectable-text">
      <header className="review-topbar">
        <div>
          <h1>본문 OCR 검수</h1>
          <p>
            {done}/{items.length} 완료 · 표시 {visibleItems.length}건 · 이미지 {data.copiedImages}개
          </p>
        </div>
        <div className="review-actions">
          <label className="review-import">
            가져오기
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importResult(file)
              }}
            />
          </label>
          <button type="button" onClick={exportResult}>내보내기</button>
        </div>
      </header>

      <section className="review-progress" aria-label="검수 진행률">
        <span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </section>

      <section className="review-layout">
        <aside className="review-list">
          <div className="review-list-controls">
            <label>
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              완료 포함
            </label>
          </div>
          {visibleItems.map((item, itemIndex) => {
            const state = edits[item.id]?.decision ?? 'pending'
            return (
              <button
                key={item.id}
                type="button"
                className={item.id === current.id ? 'active' : ''}
                onClick={() => setIndex(itemIndex)}
              >
                <span>{item.id}</span>
                <strong>{item.book} {item.chapter}장</strong>
                <em>{state === 'pending' ? '대기' : state}</em>
              </button>
            )
          })}
        </aside>

        <section className="review-detail">
          <div className="review-card review-meta">
            <div>
              <span>위치</span>
              <strong>{current.book} {current.chapter}장 line {current.line}</strong>
            </div>
            <div>
              <span>사유</span>
              <strong>{current.reasons.join(', ')}</strong>
            </div>
            <div>
              <span>스캔</span>
              <strong>
                {current.source
                  ? `${current.source.pdf} p${String(current.source.page).padStart(4, '0')} q${current.source.q}`
                  : '위치 없음'}
              </strong>
            </div>
          </div>

          <div className="review-card review-image">
            {current.image ? (
              <img src={`${BASE}${current.image}`} alt={`${current.book} ${current.chapter}장 원본 crop`} />
            ) : (
              <p>이미지가 없는 항목입니다. 앞뒤 문맥으로만 판단하세요.</p>
            )}
          </div>

          <div className="review-card review-context">
            <p><span>이전</span>{current.before || '-'}</p>
            <p className="problem"><span>원문 OCR</span>{current.original}</p>
            <p><span>다음</span>{current.after || '-'}</p>
          </div>

          <div className="review-card review-editor">
            <label htmlFor="confirm-text">확정 본문</label>
            <textarea
              id="confirm-text"
              value={currentEdit.confirm}
              onChange={(event) => updateCurrent({ confirm: event.target.value, decision: 'replace' })}
            />
            <input
              value={currentEdit.note}
              onChange={(event) => updateCurrent({ note: event.target.value })}
              placeholder="메모"
            />
            <div className="review-decision">
              <button type="button" onClick={() => decide('replace', currentEdit.confirm)}>확정</button>
              <button type="button" onClick={() => decide('delete', '')}>삭제</button>
              <button type="button" onClick={() => decide('keep', current.original)}>원문 유지</button>
              <button type="button" onClick={() => updateCurrent({ decision: 'pending' })}>보류</button>
            </div>
          </div>

          <div className="review-nav">
            <button type="button" onClick={() => setIndex((value) => Math.max(value - 1, 0))}>이전</button>
            <button type="button" onClick={() => setIndex((value) => Math.min(value + 1, visibleItems.length - 1))}>다음</button>
          </div>
        </section>
      </section>
    </main>
  )
}
