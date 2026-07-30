/** 세트 전환 이전의 권 메타데이터다. */
export interface LegacyBinderBook {
  id: string
  issue: string
  file: string
  pages: number
  lang: 'ko' | 'en'
}

/** 생성된 바인더 세트의 매핑 메타데이터다. */
export interface BinderSetSource {
  id: string
  pages: number
  checkpoints: Array<{ id: string; issue: string; page: number }>
}

/** 페이지 좌표를 옮길 수 있는 옛 BinderWork 구조다. */
export interface LegacyBinderWork<TField = unknown, TTextBox = unknown> {
  bookId: string
  transcription: TField
  notes: TField
  pageInputs: Record<string, TField>
  pageTextBoxes: Record<string, TTextBox[]>
  bookmarks: Array<{ id: string; page: number; label: string; createdAt: number }>
  lastPageNumber?: number
  checkpointPages?: Record<string, number>
  updatedAt: number
}

/** 일반 회차 권에서 주제별 섹션이 시작하는 원본 쪽이다. */
export const SECTION: { meditation: 7; timothy: 43; bookStudy: 55 }

/** 00-01 권에서 주제별 섹션이 시작하는 원본 쪽이다. */
export const FIRST: { issue: '00-01'; meditation: 113; timothy: 151; bookStudy: 163 }

/** 세트 전환 이전의 한국어·영어 회차별 권 목록이다. */
export const legacyBinderBooks: LegacyBinderBook[]

/** 옛 권의 쪽을 생성된 세트의 쪽 좌표로 변환한다. */
export function legacyPageToSet(
  bookId: string,
  page: number,
  sets: BinderSetSource[],
): { setId: string; page: number } | null

/** 옛 BinderWork 목록을 세트별 BinderWork 목록으로 병합한다. */
export function migrateLegacyWorks<TField, TTextBox>(
  oldWorks: Array<LegacyBinderWork<TField, TTextBox>>,
  sets: BinderSetSource[],
): Array<LegacyBinderWork<TField, TTextBox>>

/** migrated data와 기존 target을 합치며 같은 key에서는 existing target을 보존한다. */
export function mergeBinderWorks<TField, TTextBox>(
  migrated: LegacyBinderWork<TField, TTextBox>,
  existing: LegacyBinderWork<TField, TTextBox>,
  maximumPage?: number,
): LegacyBinderWork<TField, TTextBox>
