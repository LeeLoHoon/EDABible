import { v4 as uuid } from 'uuid'
import { getLang } from './i18n/lang'

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
  questionSet?: QuestionSetId // 사용할 5가지 질문 세트 (없으면 기본값)
  answers: Field[] // 5가지 질문 답변 (길이 5) — 세트끼리 같은 칸을 공유
  spousePrayer: Field // 배우자 기도
  prayerTopics: Field[] // 기도제목 (가변)
  prayerTopics2?: Field[] // 두 번째 기도 세트 — 기도제목 (옵션, 세트 추가 시에만 존재)
  spousePrayer2?: Field // 두 번째 기도 세트 — 배우자 기도 (옵션)
  temptationVictory: TemptationVictory // 7가지 단계 / 죄로부터 승리
  /** @deprecated 구 "구절 전체 탭 토글" 데이터. 기능은 제거됐고, useEntry의
      normalizeEntry가 로드 시 gold 전체 range(highlightRanges)로 마이그레이션한다. */
  highlightedVerses?: string[]
  /** 형광펜으로 칠한 하이라이트. key 포맷: 절 마커 있는 문단은 '<장 카운터>:<절 라벨>'
      (예: '3:12') — 장 카운터는 본문 시작 장에서 출발해 절 번호가 리셋될 때마다 +1 되는
      논리 값이라 다장·다권 본문에서도 유일하다. 절 마커 없는 문단은 'p<블록 인덱스>'
      (스캔 전사본 대응). PassageText가 동일 규칙으로 재계산하며, 본문 편집으로
      어긋난 range는 렌더에서 clamp/무시된다(orphan 허용). */
  highlightRanges?: VerseHighlight[]
  createdAt: number
  updatedAt: number
}

export type HighlightColor = 'gold' | 'green' | 'pink'

/** 구절 내 부분 하이라이트 — start/end는 해당 구절 세그먼트 텍스트(트림된 한 줄,
    PassageText의 block.text)의 문자 오프셋 [start, end). key 규칙은 highlightedVerses와
    동일. 본문 편집으로 어긋난 range는 렌더에서 clamp/무시된다(orphan 허용). 같은 key
    안에서 range끼리 겹치지 않는 불변식은 PassageText의 applyRanges가 유지한다. */
export interface VerseHighlight {
  key: string
  start: number
  end: number
  color: HighlightColor
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

/** 질문 한 개 — 문장 + 강조 키워드 + (선택)괄호 부가설명 */
export interface QuestionItem {
  text: string
  keyword: string
  hint?: string
}

export type QuestionSetId = 'meditation' | 'review'

export interface QuestionSet {
  id: QuestionSetId
  label: string
  questions: QuestionItem[] // 길이 5 고정
}

/** 선택 가능한 5가지 질문 세트들 (첫 번째가 기본값) */
const QUESTION_SETS_KO: QuestionSet[] = [
  {
    id: 'review',
    label: '하루 돌아보기 A',
    questions: [
      { text: '오늘 내가 발견한 것은 무엇입니까?', keyword: '발견한', hint: '깨달은 것' },
      { text: '오늘 내가 다른 사람에게 나누어 준 것은 무엇입니까?', keyword: '나누어 준' },
      { text: '오늘 내가 받은 것은 무엇입니까?', keyword: '받은' },
      {
        text: '오늘 내가 발전시킨 것은 무엇입니까?',
        keyword: '발전시킨',
        hint: '아침 말씀묵상을 삶에 적용/기도응답/열매',
      },
      { text: '오늘 내가 용서하거나 놓아주어야 하는 것은 무엇입니까?', keyword: '용서하거나 놓아주어야 하는' },
    ],
  },
  {
    id: 'meditation',
    label: '하루 돌아보기 B',
    questions: [
      { text: '나는 오늘 어떤 말을 했는가?', keyword: '말' },
      { text: '나는 오늘 어떤 시간을 보냈는가?', keyword: '시간' },
      { text: '나는 오늘 어떤 만남을 가졌는가?', keyword: '만남' },
      { text: '나는 오늘 어떤 일을 바로 실천했는가?', keyword: '일' },
      { text: '나는 오늘 어떤 자기 관리를 했는가?', keyword: '자기 관리' },
    ],
  },
]

const QUESTION_SETS_EN: QuestionSet[] = [
  {
    id: 'review',
    label: 'Daily Review A',
    questions: [
      { text: 'What did I discover today?', keyword: 'discover', hint: 'things I realized' },
      { text: 'What did I share with others today?', keyword: 'share' },
      { text: 'What did I receive today?', keyword: 'receive' },
      {
        text: 'What did I develop today?',
        keyword: 'develop',
        hint: 'applying the morning meditation / answered prayers / fruit',
      },
      { text: 'What do I need to forgive or let go of today?', keyword: 'forgive or let go of' },
    ],
  },
  {
    id: 'meditation',
    label: 'Daily Review B',
    questions: [
      { text: 'What words did I speak today?', keyword: 'words' },
      { text: 'How did I spend my time today?', keyword: 'time' },
      { text: 'What meetings did I have today?', keyword: 'meetings' },
      { text: 'What did I put into practice right away today?', keyword: 'practice' },
      { text: 'How did I care for myself today?', keyword: 'care for myself' },
    ],
  },
]

export function getQuestionSets(): QuestionSet[] {
  return getLang() === 'en' ? QUESTION_SETS_EN : QUESTION_SETS_KO
}

export const DEFAULT_QUESTION_SET_ID: QuestionSetId = 'review'

/** id로 질문 세트 조회 — 없거나 모르는 id면 기본 세트 */
export function getQuestionSet(id: QuestionSetId | undefined): QuestionSet {
  const sets = getQuestionSets()
  return sets.find((s) => s.id === id) ?? sets[0]
}

export function emptyField(): Field {
  return { mode: 'text', text: '', strokes: [] }
}

/** 새 묵상·새 기도 세트가 처음부터 갖는 기도제목 칸 수 (추가·삭제는 그대로 가능) */
export const DEFAULT_PRAYER_TOPIC_COUNT = 3

export function emptyPrayerTopics(mode: FieldMode = 'text'): Field[] {
  return Array.from({ length: DEFAULT_PRAYER_TOPIC_COUNT }, () => ({ ...emptyField(), mode }))
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
    questionSet: DEFAULT_QUESTION_SET_ID,
    answers: getQuestionSet(DEFAULT_QUESTION_SET_ID).questions.map(() => emptyField()),
    spousePrayer: emptyField(),
    prayerTopics: emptyPrayerTopics(),
    // 기도 세트 2개가 기본 — 두 번째 세트도 처음부터 열려 있고 삭제할 수 있다
    prayerTopics2: emptyPrayerTopics(),
    spousePrayer2: emptyField(),
    temptationVictory: emptyTemptationVictory(),
    highlightRanges: [],
    createdAt: ts,
    updatedAt: ts,
  }
}
