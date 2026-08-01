/** 쪽에 기본으로 놓이는 텍스트 상자 하나 — 값은 쪽 대비 비율(0~1)이다. */
export interface BinderTextPreset {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** 타이핑할 때 인쇄된 괘선을 흰 바탕으로 가린다 */
  opaque?: boolean
}

/** 배치 유형별 상자 목록이다. */
export const binderTextLayouts: Readonly<Record<string, readonly BinderTextPreset[]>>

/** 세트별 { 배치 유형: 쪽 번호 목록 }이다. */
export const binderTextPresetPages: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>

/** 그 쪽에 기본으로 놓을 텍스트 상자 배치 — 없으면 빈 배열이다. */
export function textPresetsFor(setId: string, page: number): readonly BinderTextPreset[]
