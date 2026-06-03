import { v4 as uuid } from 'uuid'

export type FieldMode = 'text' | 'ink'

/** 손글씨 한 획: [x, y, pressure] 포인트 배열 + 펜 속성 */
export interface Stroke {
  points: [number, number, number][]
  color: string
  size: number
}

/** 입력 칸 하나 — 타이핑/손글씨 공용 */
export interface Field {
  mode: FieldMode
  text: string
  strokes: Stroke[]
}

export interface Entry {
  id: string
  date: string // 'YYYY-MM-DD'
  bibleRef: string // 장절 참조만 (예: '시편 3편') — 본문 텍스트는 저장하지 않음
  transcription: Field // 필사
  answers: Field[] // 5가지 질문 답변 (길이 5)
  spousePrayer: Field // 배우자 기도
  prayerTopics: Field[] // 기도제목 (가변)
  temptationVictory: TemptationVictory // 7가지 단계 / 죄로부터 승리
  createdAt: number
  updatedAt: number
}

export interface TemptationVictory {
  sin: Field
  stage: number | null
  stageNote: Field
  help: Field
  pray: Field
  victory: Field
  grow: Field
}

/** 이미지 기준 고정 5가지 질문 (시편 2편 묵상 틀) */
export const QUESTIONS = [
  '나는 오늘 어떤 말을 했는가?',
  '나는 오늘 어떤 시간을 보냈는가?',
  '나는 오늘 어떤 만남을 가졌는가?',
  '나는 오늘 어떤 일을 바로 실천했는가?',
  '나는 오늘 어떤 자기 관리를 했는가?',
] as const

/** 질문에서 색으로 강조할 키워드 */
export const QUESTION_KEYWORDS = ['말', '시간', '만남', '일', '자기 관리'] as const

export function emptyField(): Field {
  return { mode: 'text', text: '', strokes: [] }
}

export function emptyTemptationVictory(): TemptationVictory {
  return {
    sin: emptyField(),
    stage: null,
    stageNote: emptyField(),
    help: emptyField(),
    pray: emptyField(),
    victory: emptyField(),
    grow: emptyField(),
  }
}

export function isFieldEmpty(f: Field): boolean {
  return f.text.trim() === '' && f.strokes.length === 0
}

/** 'YYYY-MM-DD' (로컬 시간 기준) */
export function todayKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function createEntry(now: Date): Entry {
  const ts = now.getTime()
  return {
    id: uuid(),
    date: todayKey(now),
    bibleRef: '',
    transcription: emptyField(),
    answers: QUESTIONS.map(() => emptyField()),
    spousePrayer: emptyField(),
    prayerTopics: [emptyField()],
    temptationVictory: emptyTemptationVictory(),
    createdAt: ts,
    updatedAt: ts,
  }
}
