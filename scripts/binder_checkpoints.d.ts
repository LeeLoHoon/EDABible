/** 세트 PDF에서 실측한 체크포인트 한 개다. */
export interface BinderScannedCheckpoint {
  id: string
  page: number
  label: string
}

/** 세트별 실측 체크포인트다. */
export const binderCheckpoints: Readonly<Record<string, readonly BinderScannedCheckpoint[]>>

/** 세트의 실측 체크포인트 — 없으면 null이다. */
export function checkpointsFor(setId: string): readonly BinderScannedCheckpoint[] | null
