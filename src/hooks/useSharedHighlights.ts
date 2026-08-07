import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PassageChunk } from '../components/BiblePicker'
import { getChapterHighlights, saveChapterHighlights } from '../db'
import { applyRanges, removeRange } from '../highlights'
import { splitBlocks } from '../passageBlocks'
import type { VerseHighlight } from '../types'
import {
  buildHighlightAnchors,
  chapterKey,
  chapterRefsOf,
  groupRangesByChapter,
  parseChapterKey,
  toRenderRanges,
} from '../verseHighlights'

const EMPTY_RANGES: VerseHighlight[] = []

/**
 * 형광펜을 성경 본문에 귀속시켜 읽고 쓴다. 묵상 노트와 설교 노트가 같은 저장소를 보므로,
 * 어느 쪽에서 긋든 같은 구절이면 같은 밑줄이 보인다.
 *
 * PassageText는 화면 기준 상대 키로 구절을 가리키고 저장소는 장 단위 절대 좌표를 쓴다 —
 * 그 사이 변환은 verseHighlights.ts가 맡고, 여기서는 로드·저장 흐름만 다룬다.
 */
export function useSharedHighlights(
  chunks: readonly PassageChunk[],
  startChapter: number,
  ownerId: string,
  version: string,
) {
  const blocks = useMemo(() => splitBlocks(chunks, startChapter), [chunks, startChapter])
  const anchors = useMemo(() => buildHighlightAnchors(blocks), [blocks])
  const refs = useMemo(() => chapterRefsOf(anchors), [anchors])
  // 장 목록이 실제로 바뀐 때만 다시 읽도록 — 배열은 렌더마다 새 참조가 된다
  const refsKey = useMemo(() => refs.map(chapterKey).sort().join(','), [refs])

  const [stored, setStored] = useState<ReadonlyMap<string, VerseHighlight[]>>(new Map())

  useEffect(() => {
    let alive = true
    // 장 목록이 비면 getChapterHighlights가 빈 Map을 돌려주므로 분기하지 않는다
    void getChapterHighlights(ownerId, version, refs)
      .then((loaded) => {
        if (alive) setStored(loaded)
      })
      .catch((error) => {
        console.warn('Verse highlights could not be read.', error)
      })
    return () => {
      alive = false
    }
    // refsKey가 장 목록을 대표한다 — refs 배열 참조는 렌더마다 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, version, refsKey])

  /** 화면 좌표로 되돌린 밑줄 — PassageText가 memo를 유지하도록 안정 참조로 준다 */
  const ranges = useMemo(() => {
    const rendered = toRenderRanges(anchors, stored)
    return rendered.length > 0 ? rendered : EMPTY_RANGES
  }, [anchors, stored])

  /** 바뀐 장만 골라 로컬에 확정하고 원격에 올린다 */
  const commitChapters = useCallback(
    (next: Map<string, VerseHighlight[]>) => {
      setStored((prev) => {
        const merged = new Map(prev)
        for (const [key, value] of next) merged.set(key, value)
        return merged
      })
      for (const [key, value] of next) {
        const ref = parseChapterKey(key)
        if (!ref) continue
        void saveChapterHighlights(ownerId, version, ref, value).catch((error) => {
          console.warn('Verse highlight save failed.', error)
        })
      }
    },
    [ownerId, version],
  )

  const applyHighlights = useCallback(
    (adds: VerseHighlight[]) => {
      // 칠한 구절이 속한 장만 건드린다 — 본문에 걸친 다른 장까지 다시 쓰면
      // 손대지도 않은 장의 revision이 올라가 다른 기기와 충돌한다
      const addsByChapter = groupRangesByChapter(anchors, adds)
      const next = new Map<string, VerseHighlight[]>()
      for (const [key, chapterAdds] of addsByChapter) {
        next.set(key, applyRanges(stored.get(key) ?? [], chapterAdds))
      }
      if (next.size > 0) commitChapters(next)
    },
    [anchors, commitChapters, stored],
  )

  const removeHighlight = useCallback(
    (key: string, start: number, end: number) => {
      const anchor = anchors.find((item) => item.verseKey === key)
      if (!anchor) return
      const chapter = chapterKey(anchor)
      const current = stored.get(chapter)
      if (!current) return
      commitChapters(
        new Map([[chapter, removeRange(current, anchor.chapterVerseKey, start, end)]]),
      )
    },
    [anchors, commitChapters, stored],
  )

  return { ranges, applyHighlights, removeHighlight }
}
