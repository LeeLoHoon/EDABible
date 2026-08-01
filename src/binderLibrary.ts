import { binderSets } from './binderSets'
import { getLang, type Lang } from './i18n/lang'
import { t } from './i18n/strings'
import { checkpointsFor } from '../scripts/binder_checkpoints'

/** 바인더 파트의 주제 종류다. */
export type BinderSetKind =
  | 'starter'
  | 'edaPrayer'
  | 'deliverance'
  | 'meditation'
  | 'timothy'
  | 'bookStudy'

/**
 * 화면에 표시할 바인더 파트다.
 *
 * 한 PDF를 여러 파트로 나눠 보여줄 수 있다(새신자 PDF의 에다·축사 기도문). 그래서
 * PDF 파일(`pdfId`)·필기 저장 키(`workId`)·화면 파트(`id`)를 따로 둔다. 필기와 책갈피는
 * PDF 쪽 번호로 저장되므로 같은 PDF를 나눠도 기존 기록이 그대로 열린다.
 */
export interface BinderSet {
  id: string
  pdfId: string
  workId: string
  kind: BinderSetKind
  lang: Lang
  /** 이 파트가 보여줄 PDF 쪽 범위 (양끝 포함) */
  pageStart: number
  pageEnd: number
  /** 파트의 쪽 수 */
  pages: number
  /** PDF 파일 전체 쪽 수 */
  pdfPages: number
}

/** 화면 이동에 쓰는 바인더 체크포인트다. */
export interface BinderCheckpoint {
  id: string
  label: string
  page: number
}

interface SetMeta {
  id: string
  pdfId?: string
  kind: BinderSetKind
  lang: Lang
  /** 한 PDF를 나눌 때만 지정한다 — 비우면 PDF 전체가 한 파트다 */
  range?: { start: number; end: number }
}

/**
 * 새신자 PDF는 그리스도인의 확신 다음에 에다 기도문(71쪽~)과 축사 기도문(95쪽~)이
 * 이어진다. 세 부분은 쓰임이 달라 파트로 나눠 고르게 한다. 쪽 경계는 원본 00-01호의
 * 체크포인트 쪽과 같다.
 */
const STARTER_EDA_PRAYER_PAGE = 71
const STARTER_DELIVERANCE_PAGE = 95

const SET_META: SetMeta[] = [
  {
    id: 'spl-starter',
    kind: 'starter',
    lang: 'ko',
    range: { start: 1, end: STARTER_EDA_PRAYER_PAGE - 1 },
  },
  {
    id: 'spl-starter-eda-prayer',
    pdfId: 'spl-starter',
    kind: 'edaPrayer',
    lang: 'ko',
    range: { start: STARTER_EDA_PRAYER_PAGE, end: STARTER_DELIVERANCE_PAGE - 1 },
  },
  {
    id: 'spl-starter-deliverance',
    pdfId: 'spl-starter',
    kind: 'deliverance',
    lang: 'ko',
    range: { start: STARTER_DELIVERANCE_PAGE, end: Number.POSITIVE_INFINITY },
  },
  { id: 'spl-meditation', kind: 'meditation', lang: 'ko' },
  { id: 'spl-timothy', kind: 'timothy', lang: 'ko' },
  { id: 'spl-bookstudy', kind: 'bookStudy', lang: 'ko' },
  { id: 'spl-meditation-en', kind: 'meditation', lang: 'en' },
  { id: 'spl-timothy-en', kind: 'timothy', lang: 'en' },
  { id: 'spl-bookstudy-en', kind: 'bookStudy', lang: 'en' },
]

/** 현재 언어에서 표시할 바인더 파트 목록이다. */
export const binderSetList: BinderSet[] = SET_META.filter((meta) => meta.lang === getLang()).flatMap(
  (meta) => {
    const pdfId = meta.pdfId ?? meta.id
    const generated = binderSets.find((set) => set.id === pdfId)
    if (!generated) return []
    const pageStart = Math.max(1, meta.range?.start ?? 1)
    const pageEnd = Math.min(generated.pages, meta.range?.end ?? generated.pages)
    if (pageEnd < pageStart) return []
    return [
      {
        id: meta.id,
        pdfId,
        // 필기·책갈피는 PDF 단위로 저장한다 — 파트를 나눠도 기존 기록이 그대로 열린다
        workId: pdfId,
        kind: meta.kind,
        lang: meta.lang,
        pageStart,
        pageEnd,
        pages: pageEnd - pageStart + 1,
        pdfPages: generated.pages,
      },
    ]
  },
)

/** 바인더 PDF 주소를 만든다. */
export function binderPdfUrl(pdfId: string): string {
  return `${import.meta.env.BASE_URL}binder/${pdfId}.pdf`
}

/** 바인더 파트가 쓰는 PDF 주소를 만든다. */
export function binderUrl(set: BinderSet): string {
  return binderPdfUrl(set.pdfId)
}

/** 현재 언어의 바인더 파트를 id로 찾는다. */
export function findBinderSet(id: string): BinderSet | undefined {
  return binderSetList.find((set) => set.id === id)
}

/** 현재 언어에 표시되는 바인더 파트 id인지 확인한다. */
export function isKnownBinderSetId(id: string): boolean {
  return binderSetList.some((set) => set.id === id)
}

/** 저장된 필기 키(PDF id)로 열 파트를 고른다 — 나뉜 PDF는 첫 파트를 연다. */
export function findBinderSetByWorkId(workId: string): BinderSet | undefined {
  return binderSetList.find((set) => set.workId === workId)
}

/**
 * 파트에서 쓸 체크포인트다. 성경묵상·디모데·책공부는 PDF에서 실측한 목록
 * (`scripts/binder_checkpoints.mjs`)을 쓰고, 새신자 계열은 원본 쪽번호 상수를 쓴다.
 * 어느 쪽이든 그 파트의 쪽 범위 안에 있는 것만 남긴다.
 */
export function checkpointsForSet(set: BinderSet): BinderCheckpoint[] {
  const scanned = checkpointsFor(set.pdfId)
  const all: BinderCheckpoint[] = scanned
    ? scanned.map((checkpoint) => ({
        id: checkpoint.id,
        label: checkpoint.label,
        page: checkpoint.page,
      }))
    : t('binderCheckpoints').map((checkpoint) => ({ ...checkpoint }))

  return all.filter(
    (checkpoint) => checkpoint.page >= set.pageStart && checkpoint.page <= set.pageEnd,
  )
}
