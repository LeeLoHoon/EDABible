import { memo, useMemo, type ReactNode } from 'react'

interface Props {
  text: string
  /** 하이라이트 키 계산의 시작 장 — 생략 시 1 */
  startChapter?: number
  /** 하이라이트(형광 밑줄)된 구절 키 목록 — 안정 참조 필수(normalizeEntry가 보장) */
  highlights?: readonly string[]
  /** 구절 탭 토글 콜백 — 생략하면 기존과 동일한 비인터랙티브 렌더 */
  onToggleVerse?: (verseKey: string) => void
}

const VERSE_MARKER = /\((\d{1,3}(?:[-~]\d{1,3})?)\)\s*/g
const HEADING_MARKER = /^\[\[(.+)\]\]$/
const PAREN_HEADING = /^\((?!\d{1,3}(?:[-~]\d{1,3})?\))(.{2,80})\)$/

interface Segment {
  label: string | null
  text: string
}

type Block =
  | {
      type: 'heading'
      text: string
    }
  | {
      type: 'segment'
      label: string | null
      text: string
      /** '<장 카운터>:<절 라벨>' — 라벨 없는 세그먼트(도입부·다권 ref 라인)는 null */
      verseKey: string | null
    }

function splitPassage(text: string): Segment[] {
  const segments: Segment[] = []
  let currentLabel: string | null = null
  let last = 0

  for (const match of text.matchAll(VERSE_MARKER)) {
    const before = text.slice(last, match.index).trim()
    if (before) segments.push({ label: currentLabel, text: before })
    currentLabel = match[1].replace('~', '-')
    last = match.index + match[0].length
  }

  const tail = text.slice(last).trim()
  if (tail) segments.push({ label: currentLabel, text: tail })

  return segments.length > 0 ? segments : [{ label: null, text }]
}

/* 다장 본문은 장 텍스트가 경계 표시 없이 이어 붙으므로, 절 번호가 리셋되면
   (선두 숫자 < 직전 라벨의 말미 숫자) 다음 장으로 간주해 카운터를 올린다.
   같은 본문에서 항상 동일하게 재계산되므로 키가 결정적이다.
   ※ 실제 book:chapter 기반 키가 필요해지면 BiblePicker가 장별 텍스트를
   내려주도록 확장하는 것이 정도(正道) — 후속 업그레이드 경로. */
function splitBlocks(text: string, startChapter: number): Block[] {
  const blocks: Block[] = []
  let chapter = startChapter
  let prevVerseEnd = 0

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const heading = line.match(HEADING_MARKER)
    if (heading) {
      blocks.push({ type: 'heading', text: heading[1].trim() })
      continue
    }

    const parentheticalHeading = line.match(PAREN_HEADING)
    if (parentheticalHeading) {
      blocks.push({ type: 'heading', text: parentheticalHeading[1].trim() })
      continue
    }

    for (const segment of splitPassage(line)) {
      let verseKey: string | null = null
      if (segment.label) {
        const nums = segment.label.split('-').map(Number)
        const first = nums[0]
        const last = nums[nums.length - 1]
        if (prevVerseEnd > 0 && first < prevVerseEnd) chapter += 1
        prevVerseEnd = last
        verseKey = `${chapter}:${segment.label}`
      }
      blocks.push({ type: 'segment', ...segment, verseKey })
    }
  }

  return blocks
}

function renderText(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, index, lines) =>
    index === lines.length - 1 ? [line] : [line, <br key={index} />],
  )
}

// memo: 손글씨 획이 커밋될 때마다 EntryPage 전체가 재렌더되는데, 그때마다
// 장 전체를 재파싱·재렌더하면 다음 획 입력 처리가 밀린다. props가 같으면 건너뛴다.
// (highlights·onToggleVerse도 안정 참조여야 효과가 유지된다)
function PassageText({ text, startChapter = 1, highlights, onToggleVerse }: Props) {
  const blocks = useMemo(() => splitBlocks(text, startChapter), [text, startChapter])
  const highlightSet = useMemo(() => new Set(highlights ?? []), [highlights])

  const handleTap = (verseKey: string) => {
    if (!onToggleVerse) return
    // 펜 필기 중(ink-active) 손바닥·펜 오탭으로 토글되는 것을 방지
    if (document.body.classList.contains('ink-active')) return
    // 본문 드래그 선택(복사) 직후의 click은 토글로 치지 않는다
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    onToggleVerse(verseKey)
  }

  return (
    <div className="selectable-text passage-text font-serif text-[15px] leading-[1.75] text-rose-ink">
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <h4
            key={`heading-${block.text}-${index}`}
            className="mb-1.5 mt-4 font-sans text-[0.82rem] font-black text-rose-ink first:mt-0"
          >
            {block.text}
          </h4>
        ) : (
          <p
            key={`${block.label ?? 'intro'}-${index}`}
            className={`passage-segment${onToggleVerse && block.verseKey ? ' verse-tap' : ''}`}
            onClick={
              onToggleVerse && block.verseKey ? () => handleTap(block.verseKey!) : undefined
            }
          >
            {block.label && <span className="passage-verse">{block.label}</span>}
            <span
              className={`verse-body${
                block.verseKey && highlightSet.has(block.verseKey) ? ' verse-mark' : ''
              }`}
            >
              {renderText(block.text)}
            </span>
          </p>
        ),
      )}
    </div>
  )
}

export default memo(PassageText)
