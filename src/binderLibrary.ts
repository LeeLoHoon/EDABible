import { binderSets, type BinderSetCheckpoint } from './binderSets'
import { getLang, type Lang } from './i18n/lang'
import { t } from './i18n/strings'
import { checkpointTitle } from '../scripts/binder_checkpoint_titles.mjs'

/** 바인더 세트의 주제 종류다. */
export type BinderSetKind = 'starter' | 'meditation' | 'timothy' | 'bookStudy'

/** 화면에 표시할 바인더 세트 정보다. */
export interface BinderSet {
  id: string
  kind: BinderSetKind
  lang: Lang
  pages: number
  checkpoints: BinderSetCheckpoint[]
}

/** 화면 이동에 쓰는 바인더 체크포인트다. */
export interface BinderCheckpoint {
  id: string
  label: string
  page: number
}

const SET_META: Array<Pick<BinderSet, 'id' | 'kind' | 'lang'>> = [
  { id: 'spl-starter', kind: 'starter', lang: 'ko' },
  { id: 'spl-meditation', kind: 'meditation', lang: 'ko' },
  { id: 'spl-timothy', kind: 'timothy', lang: 'ko' },
  { id: 'spl-bookstudy', kind: 'bookStudy', lang: 'ko' },
  { id: 'spl-meditation-en', kind: 'meditation', lang: 'en' },
  { id: 'spl-timothy-en', kind: 'timothy', lang: 'en' },
  { id: 'spl-bookstudy-en', kind: 'bookStudy', lang: 'en' },
]

/** 현재 언어에서 표시할 바인더 세트 목록이다. */
export const binderSetList: BinderSet[] = SET_META.filter((meta) => meta.lang === getLang()).flatMap(
  (meta) => {
    const generated = binderSets.find((set) => set.id === meta.id)
    return generated ? [{ ...meta, pages: generated.pages, checkpoints: generated.checkpoints }] : []
  },
)

/** 바인더 세트 PDF 주소를 만든다. */
export function binderUrl(set: BinderSet): string {
  return `${import.meta.env.BASE_URL}binder/${set.id}.pdf`
}

/** 현재 언어의 바인더 세트를 id로 찾는다. */
export function findBinderSet(id: string): BinderSet | undefined {
  return binderSetList.find((set) => set.id === id)
}

/** 현재 언어에 표시되는 바인더 세트 id인지 확인한다. */
export function isKnownBinderSetId(id: string): boolean {
  return binderSetList.some((set) => set.id === id)
}

/** 바인더 세트에서 유효한 화면용 체크포인트를 만든다. */
export function checkpointsForSet(set: BinderSet): BinderCheckpoint[] {
  if (set.kind === 'starter') {
    return t('binderCheckpoints').filter((checkpoint) => checkpoint.page <= set.pages)
  }

  return set.checkpoints
    .filter((checkpoint) => checkpoint.page <= set.pages)
    .map((checkpoint) => ({
      id: checkpoint.id,
      label:
        (set.kind === 'timothy' || set.kind === 'bookStudy'
          ? checkpointTitle(set.id, checkpoint.id, getLang())
          : undefined) ?? t('binderIssue')(checkpoint.issue),
      page: checkpoint.page,
    }))
}
