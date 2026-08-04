/* 묵상 보관함의 목록 조립 — 화면에서 떼어 낸 순수 로직.

   보관함은 두 가지 원천을 합쳐서 만든다. 서버가 준 '내 묵상 요약'(list_my_sermon_notes)과
   설교 목록이다. '내 묵상'만 볼 때는 전자만으로 충분하고, '전체 설교'로 볼 때는 후자에
   내 기록을 붙여 보여준다. 날짜 키가 'YYYY-MM-DD'라 문자열 정렬이 곧 시간순이다. */

import type { Sermon, SermonNoteSummary, SermonPassage, SermonService } from './db'
import { compareSermonService } from './sermon'

export interface ArchiveRow {
  sermonId: string
  preachedOn: string
  service: SermonService
  title: string
  titleEn?: string
  passages: SermonPassage[]
  /** 내가 이 설교에 남긴 기록. 없으면 아직 쓰지 않은 주일이다 */
  note?: SermonNoteSummary
}

function rowFromNote(note: SermonNoteSummary): ArchiveRow {
  return {
    sermonId: note.sermonId,
    preachedOn: note.preachedOn,
    service: note.service,
    title: note.title,
    ...(note.titleEn ? { titleEn: note.titleEn } : {}),
    passages: note.passages,
    note,
  }
}

function rowFromSermon(sermon: Sermon, note: SermonNoteSummary | undefined): ArchiveRow {
  return {
    sermonId: sermon.id,
    preachedOn: sermon.preachedOn,
    service: sermon.service,
    title: sermon.title,
    ...(sermon.titleEn ? { titleEn: sermon.titleEn } : {}),
    passages: sermon.passages,
    ...(note ? { note } : {}),
  }
}

/**
 * 보관함에 늘어놓을 줄을 만든다 — 최신 주일이 위, 같은 날은 오전 → 오후 순.
 * 전체 보기에서도 게시가 내려간 설교는 감추되, 내 묵상이 달려 있으면 계속 보여준다.
 */
export function buildArchiveRows(
  notes: readonly SermonNoteSummary[],
  sermons: readonly Sermon[],
  showAll: boolean,
): ArchiveRow[] {
  const noteBySermon = new Map(notes.map((note) => [note.sermonId, note]))
  const rows = showAll
    ? sermons
        .filter((sermon) => sermon.published || noteBySermon.has(sermon.id))
        .map((sermon) => rowFromSermon(sermon, noteBySermon.get(sermon.id)))
    : notes.map(rowFromNote)

  return [...rows].sort(
    (a, b) => b.preachedOn.localeCompare(a.preachedOn) || compareSermonService(a.service, b.service),
  )
}

/**
 * 서버 목록과 이 기기의 기록을 합친다. 같은 설교가 양쪽에 있으면 더 최근에 손댄 쪽을 남긴다 —
 * 서버 저장이 실패해 로컬에만 남은 기록이 보관함에서 사라지지 않게 하기 위해서다.
 */
export function mergeNoteSummaries(
  remote: readonly SermonNoteSummary[],
  local: readonly SermonNoteSummary[],
): SermonNoteSummary[] {
  const byId = new Map(remote.map((note) => [note.sermonId, note]))
  for (const note of local) {
    const known = byId.get(note.sermonId)
    if (!known || note.updatedAt > known.updatedAt) byId.set(note.sermonId, note)
  }
  return [...byId.values()]
}

/** 연 → 월 → 그 달의 줄들. 키는 'YYYY'와 'MM' 문자열이라 정렬만으로 시간순이 된다. */
export function groupByYearMonth(
  rows: readonly ArchiveRow[],
): Map<string, Map<string, ArchiveRow[]>> {
  const byYear = new Map<string, Map<string, ArchiveRow[]>>()
  for (const row of rows) {
    const year = row.preachedOn.slice(0, 4)
    const month = row.preachedOn.slice(5, 7)
    const byMonth = byYear.get(year) ?? new Map<string, ArchiveRow[]>()
    byMonth.set(month, [...(byMonth.get(month) ?? []), row])
    byYear.set(year, byMonth)
  }
  return byYear
}

/** 그 해에 묵상을 남긴 주일이 몇 번인지 — 오전·오후를 함께 쓴 주일은 한 번으로 센다 */
export function countWrittenWeeks(notes: readonly SermonNoteSummary[], year: string): number {
  const weeks = new Set(
    notes
      .filter((note) => note.preachedOn.startsWith(`${year}-`))
      .map((note) => note.preachedOn),
  )
  return weeks.size
}
