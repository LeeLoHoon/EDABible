import type { ReactNode } from 'react'

interface Props {
  text: string
}

const VERSE_MARKER = /\((\d{1,3}(?:[-~]\d{1,3})?)\)\s*/g

interface Segment {
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

function renderText(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, index, lines) =>
    index === lines.length - 1 ? [line] : [line, <br key={index} />],
  )
}

export default function PassageText({ text }: Props) {
  const segments = splitPassage(text)

  return (
    <div className="selectable-text passage-text font-serif text-[15px] leading-[1.75] text-zinc-700">
      {segments.map((segment, index) => (
        <p key={`${segment.label ?? 'intro'}-${index}`} className="passage-segment">
          {segment.label && <span className="passage-verse">{segment.label}</span>}
          <span>{renderText(segment.text)}</span>
        </p>
      ))}
    </div>
  )
}
