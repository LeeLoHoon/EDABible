/** 바인더 요약 영상 한 과의 메타데이터다. */
export interface BinderVideoLesson {
  no: number
  page: number
  title: string
  videoId: string
}

/** 바인더 요약 영상 단계와 시작 쪽이다. */
export interface BinderVideoStage {
  stage: string
  page: number
  lessons: BinderVideoLesson[]
}

/** YouTube video ID 형식이다. */
export const YOUTUBE_ID_RE: RegExp

/** 바인더 세트별 요약 영상 단계다. */
export const binderVideos: Record<string, BinderVideoStage[]>

/** 등록된 바인더 세트의 요약 영상 단계만 반환한다. */
export function videoStagesFor(setId: string): BinderVideoStage[] | undefined

/** 현재 쪽에 해당하는 마지막 시작 단계를 찾는다. */
export function currentVideoStage(setId: string, page: number): BinderVideoStage | undefined

/** 느낀점 쪽 바로 앞에 표시할 영상 과를 찾는다. */
export function lessonVideoBeforePage(
  setId: string,
  page: number,
): { stage: BinderVideoStage; lesson: BinderVideoLesson } | undefined
