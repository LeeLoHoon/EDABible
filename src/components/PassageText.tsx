import { memo, type ReactNode } from 'react'

interface Props {
  text: string
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

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []

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
      blocks.push({ type: 'segment', ...segment })
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
// 장 전체를 재파싱·재렌더하면 다음 획 입력 처리가 밀린다. text가 같으면 건너뛴다.
function PassageText({ text }: Props) {
  const blocks = splitBlocks(text)

  return (
    <div className="selectable-text passage-text font-serif text-[15px] leading-[1.75] text-zinc-700">
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <h4
            key={`heading-${block.text}-${index}`}
            className="mb-1.5 mt-4 font-sans text-[0.82rem] font-black text-rose-ink first:mt-0"
          >
            {block.text}
          </h4>
        ) : (
          <p key={`${block.label ?? 'intro'}-${index}`} className="passage-segment">
            {block.label && <span className="passage-verse">{block.label}</span>}
            <span>{renderText(block.text)}</span>
          </p>
        ),
      )}
    </div>
  )
}

export default memo(PassageText)
