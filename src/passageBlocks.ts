import type { PassageChunk } from './components/BiblePicker'

/* 본문 문자열 → 제목/구절 블록 파싱.
   PassageText(본문 렌더·하이라이트 키)와 TranscribeGuide(따라쓰기)가 같은
   블록 시퀀스를 봐야 하므로 한 곳에서 관리한다. */

const VERSE_MARKER = /\((\d{1,3}(?:[-~]\d{1,3})?)\)\s*/g
const HEADING_MARKER = /^\[\[(.+)\]\]$/
const PAREN_HEADING = /^\((?!\d{1,3}(?:[-~]\d{1,3})?\))(.{2,80})\)$/

interface Segment {
  label: string | null
  text: string
}

/** 장이 바뀌는 첫 블록에만 붙는다 — 이 값이 있으면 블록 앞에 구분선을 그린다 */
interface ChapterMark {
  chapterLabel?: string
}

export type Block = ChapterMark &
  (
    | {
        type: 'heading'
        text: string
      }
    | {
        type: 'segment'
        label: string | null
        text: string
        /** 절 마커 있으면 '<장 카운터>:<절 라벨>', 없으면 위치 기반 'p<블록 인덱스>' —
            스캔 전사본은 절 마커 없는 문단이 많아(365개 장) 모든 문단이 칠해질 수 있어야 한다 */
        verseKey: string
      }
  )

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

/* 장 경계는 chunk가 알려주지만, 하이라이트 키의 '장 카운터'는 예전 그대로
   절 번호 리셋(선두 숫자 < 직전 라벨의 말미 숫자)으로 추론한다. 이미 칠해둔
   하이라이트를 하나도 잃지 않기 위해서다 — 이 카운터는 화면에 나오지 않는
   고유 ID일 뿐이라(types.ts) 실제 장 번호와 달라도 무방하다.
   chunk를 가로질러 blocks·chapter·prevVerseEnd가 이어지므로, 이어 붙인 문자열
   하나를 파싱하던 예전과 블록 시퀀스도 verseKey도 완전히 동일하다. */
export function splitBlocks(chunks: readonly PassageChunk[], startChapter: number): Block[] {
  const blocks: Block[] = []
  let chapter = startChapter
  let prevVerseEnd = 0
  const chapterStarts: { index: number; label: string }[] = []

  for (const chunk of chunks) {
    const chunkStart = blocks.length

    for (const rawLine of chunk.text.split('\n')) {
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
        let verseKey: string
        if (segment.label) {
          const nums = segment.label.split('-').map(Number)
          const first = nums[0]
          const last = nums[nums.length - 1]
          if (prevVerseEnd > 0 && first < prevVerseEnd) chapter += 1
          prevVerseEnd = last
          verseKey = `${chapter}:${segment.label}`
        } else {
          // 마커 없는 문단(도입부·스캔 전사 누락 등)도 위치 키로 칠할 수 있게 —
          // 본문 편집으로 인덱스가 밀리면 orphan(렌더에서 무시)으로 수용
          verseKey = `p${blocks.length}`
        }
        blocks.push({ type: 'segment', ...segment, verseKey })
      }
    }

    if (!chunk.label || blocks.length === chunkStart) continue
    chapterStarts.push({ index: chunkStart, label: chunk.label })
  }

  // 단일 장이면 구분선을 넣지 않는다 — 헤더가 이미 '시편 147편'을 보여준다.
  // 여러 장이면 시작 장까지 포함해 전부 표시한다.
  if (chapterStarts.length > 1) {
    for (const start of chapterStarts) blocks[start.index].chapterLabel = start.label
  }

  return blocks
}
