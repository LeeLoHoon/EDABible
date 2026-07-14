import { useMemo, useState } from 'react'
import type { PassageChunk } from './BiblePicker'
import { splitBlocks } from '../passageBlocks'

interface Props {
  /** 본문 조각 — PassageInfo.chunks 그대로 */
  chunks: readonly PassageChunk[]
  /** 절 파싱의 시작 장 — PassageInfo.chapter */
  startChapter: number
  /** 위치 저장 키 — 항목이나 본문이 바뀌면 키가 달라져 처음 구절부터 시작한다 */
  storageKey: string
}

/**
 * 따라쓰기 가이드 — 본문 카드가 위로 스크롤돼 사라져도, 지금 옮겨 적을 구절
 * 하나를 필사 입력칸 바로 위에 보여준다. sticky 고정 없이 일반 흐름에 놓여
 * 페이지 스크롤과 겹치지 않는다.
 */

const HIDDEN_KEY = 'edabible:transcribeGuide:hidden'
const POS_KEY = 'edabible:transcribeGuide:pos'

// 사파리 프라이빗 모드 등에서 localStorage 접근이 던질 수 있다
function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // 저장 실패 시 이번 세션 동안만 유지된다
  }
}

// 마지막으로 쓰던 위치 하나만 기억한다 — 항목마다 키를 쌓지 않는다
function readPos(key: string): number {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return 0
    const saved = JSON.parse(raw) as { key?: unknown; index?: unknown }
    if (saved.key !== key || typeof saved.index !== 'number') return 0
    return Math.max(0, Math.floor(saved.index))
  } catch {
    return 0
  }
}

function writePos(key: string, index: number): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ key, index }))
  } catch {
    // 저장 실패 시 이번 세션 동안만 유지된다
  }
}

export default function TranscribeGuide({ chunks, startChapter, storageKey }: Props) {
  const steps = useMemo(() => splitBlocks(chunks, startChapter), [chunks, startChapter])
  const [hidden, setHidden] = useState(readHidden)
  const [index, setIndex] = useState(() => readPos(storageKey))

  // 본문이 바뀌면 저장된 위치를 다시 읽는다 (렌더 중 상태 보정 패턴)
  const [prevKey, setPrevKey] = useState(storageKey)
  if (prevKey !== storageKey) {
    setPrevKey(storageKey)
    setIndex(readPos(storageKey))
  }

  const clamped = Math.min(index, steps.length - 1)
  const step = steps[clamped]

  // 여러 장을 함께 읽을 때 지금 구절이 몇 편(장)인지 — 단일 장이면 null
  const chapterLabel = useMemo(() => {
    let label: string | null = null
    for (let i = 0; i <= clamped; i += 1) {
      if (steps[i].chapterLabel) label = steps[i].chapterLabel!
    }
    return label
  }, [steps, clamped])

  if (steps.length === 0) return null

  const move = (delta: number) => {
    const next = Math.min(Math.max(clamped + delta, 0), steps.length - 1)
    setIndex(next)
    writePos(storageKey, next)
  }

  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    writeHidden(next)
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={toggleHidden}
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-rose-line bg-rose-card/60 px-3 py-2 text-xs font-bold text-rose-key transition active:scale-[0.99]"
      >
        📖 따라쓰기 가이드 펼치기
      </button>
    )
  }

  return (
    <div className="mb-2 rounded-xl border border-rose-line bg-rose-card px-3.5 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-rose-key">
          📖 따라쓰기 · {clamped + 1} / {steps.length}
          {chapterLabel && <span className="ml-1.5 text-rose-accent">{chapterLabel}</span>}
        </span>
        <button
          type="button"
          onClick={toggleHidden}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-rose-key"
        >
          숨기기 ▴
        </button>
      </div>

      {step.type === 'heading' ? (
        <p className="mt-1.5 font-sans text-[0.9rem] font-black leading-[1.7] text-rose-ink">
          {step.text}
        </p>
      ) : (
        <p className="mt-1.5 font-serif text-[15px] leading-[1.75] text-rose-ink">
          {step.label && <span className="passage-verse">{step.label}</span>}
          {step.text}
        </p>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={clamped === 0}
          className="flex-1 rounded-full border border-rose-line bg-white px-3 py-2 text-[13px] font-bold text-rose-key transition active:scale-[0.98] disabled:opacity-40"
        >
          ◀ 이전 구절
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={clamped === steps.length - 1}
          className="flex-1 rounded-full bg-rose-accent-deep px-3 py-2 text-[13px] font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-40"
        >
          다음 구절 ▶
        </button>
      </div>
    </div>
  )
}
