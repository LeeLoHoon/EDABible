/**
 * 승인된 바인더 체크포인트 제목 메타데이터.
 *
 * PDF에서 추출·확인한 첫 substantive lesson title과 마지막 substantive lesson title만 사용한다.
 * 해당 metadata가 없으면 화면은 기존 호수 label을 그대로 사용한다.
 */
export const binderCheckpointTitles = {
  'spl-timothy': {
    'issue-00-01': { ko: '고구마 전도왕 김기동 집사 간증 → 나는 누구인가' },
    'issue-02': { ko: '사랑은 허다한 죄를 → 성령님은 누구신가' },
    'issue-03': { ko: '잃어버린 도끼 → 기도란' },
    'issue-04': { ko: '독방의 예배 → 예배란' },
    'issue-05': { ko: '사형선고 → 원종수 목사님 간증 1' },
    'issue-06': { ko: '원종수 목사님 간증 2 → 율법과 복음 3' },
    'issue-07': { ko: '율법과 복음 4 → 율법과 복음 7' },
    'issue-08': { ko: '율법과 복음 8 → 율법과 복음 11' },
    'issue-09': { ko: '율법과 복음 12 → 신앙과 양육 - 자녀교육과 교회생활' },
    'issue-10': {
      ko: '가정과 부부 - 사랑하는 누이야 함께 가자 → 너희는 이렇게 기도하라 1',
    },
    'issue-11': { ko: '너희는 이렇게 기도하라 2 → 너희는 이렇게 기도하라 5' },
    'issue-12': { ko: '너희는 이렇게 기도하라 6 → 전도는 성도의 의무' },
    'issue-13': { ko: '어떻게 전도할 것인가 → 교제에 프로가 되자 (2)' },
    'issue-14': { ko: '기도 없이 능력 없다 1 → 영적 단계와 치유 2' },
    'issue-15': { ko: '영적 단계와 치유 3 → 영적 단계와 치유 6' },
    'issue-16': { ko: '영적 단계와 치유 7 → 사명자란' },
    'issue-17': { ko: '사명자의 조건 → 복음과 사명자행전의 연결고리 (3)' },
    'issue-18': { ko: '사명자 노아 → 그날이 오면' },
  },
  'spl-bookstudy': {
    'issue-00-01': { ko: '구원 1,2과 → 구원 5,6과' },
    'issue-02': { ko: '구원 7,8과 → 구원 11,12과' },
    'issue-03': { ko: '인생경영 1,2과 → 인생경영 5,6과' },
    'issue-04': { ko: '인생경영 7,8과 → 인생경영 11,12과' },
    'issue-05': { ko: '거짓 영들의 유혹 1과 → 거짓 영들의 유혹 4과' },
    'issue-06': { ko: '순종 1-3과 → 순종 7-9과' },
    'issue-07': { ko: '순종 10-12과 → 순종 15-17과' },
    'issue-08': { ko: '대적기도 서문 ~ 2부-5 → 대적기도 2부-26 ~ 2부-30' },
    'issue-09': { ko: '대적기도 2부-31 ~ 2부-37 → 대적기도 3부-20 ~ 3부-22' },
    'issue-10': { ko: '관계 1-4장 → 관계 13-14장' },
    'issue-11': { ko: '4차원의 영성 Part 1,2 → 4차원의 영성 Part 4' },
    'issue-12': { ko: '권위회복 서문 ~ Ch 2 → 권위회복 Ch 5-7' },
    'issue-13': { ko: '권위회복 Ch 8-10 → 권위회복 Ch 13,14' },
    'issue-14': {
      ko: '너 자신을 자유케 하라 서문 ~ Ch 3 → 너 자신을 자유케 하라 Ch 10,11',
    },
    'issue-15': { ko: '분별력 여는 글 ~ 2과 → 분별력 5,6과' },
    'issue-16': { ko: '분별력 7,8과 → 분별력 11과 ~ 닫는 글' },
    'issue-17': {
      ko: '하루만에 꿰뚫는 기독교 역사 1,2과 → 하루만에 꿰뚫는 기독교 역사 5,6과',
    },
    'issue-18': {
      ko: '하루만에 꿰뚫는 기독교 역사 7,8과 → 하루만에 꿰뚫는 기독교 역사 11,12과',
    },
  },
  'spl-timothy-en': {
    'issue-02': { en: 'Love Covers a Multitude of Sins → Who Is the Holy Spirit?' },
    'issue-03': { en: 'The Lost Axe → What Is Prayer?' },
    'issue-04': { en: 'Worship in a Solitary Cell → What Is Worship?' },
    'issue-05': { en: "The Death Sentence → Pastor Won Jong-su's Testimony 1" },
    'issue-06': { en: "Pastor Won Jong-su's Testimony 2 → Law and Gospel 3" },
    'issue-07': { en: 'Law and Gospel 4 → Law and Gospel 7' },
    'issue-08': { en: 'Law and Gospel 8 → Law and Gospel 11' },
    'issue-09': { en: 'Law and Gospel 12 → Faith and Nurture - Parenting and Church Life' },
    'issue-10': {
      en: 'Home and Marriage - Beloved Sister, Let Us Walk Together → Pray This Way 1',
    },
    'issue-11': { en: 'Pray This Way 2 → Pray This Way 5' },
    'issue-12': { en: "Pray This Way 6 → Evangelism Is a Believer's Duty" },
    'issue-13': { en: 'How to Evangelize → Become a Pro at Fellowship (2)' },
    'issue-14': { en: 'No Prayer, No Power 1 → Spiritual Stages and Healing 2' },
    'issue-15': { en: 'Spiritual Stages and Healing 3 → Spiritual Stages and Healing 6' },
    'issue-16': { en: 'Spiritual Stages and Healing 7 → What Is a Called One?' },
    'issue-17': {
      en: 'The Marks of a Called One → The Gospel and the Acts of the Called (3)',
    },
    'issue-18': { en: 'Noah, a Called One → When That Day Comes' },
  },
  'spl-bookstudy-en': {
    'issue-02': {
      en: 'Driven by Eternity, Lessons 7-8 → Driven by Eternity, Lessons 11-12',
    },
    'issue-03': { en: 'Making Life Work, Lessons 1-2 → Making Life Work, Lessons 5-6' },
    'issue-04': { en: 'Making Life Work, Lessons 7-8 → Making Life Work, Lessons 11-12' },
    'issue-05': { en: 'Seductions Exposed, Lesson 1 → Seductions Exposed, Lesson 4' },
    'issue-06': { en: 'Under Cover, Lessons 1-3 → Under Cover, Lessons 7-9' },
    'issue-07': { en: 'Under Cover, Lessons 10-12 → Under Cover, Lessons 15-17' },
    'issue-08': {
      en: 'Warfare Prayer, Preface ~ Pt.2-5 → Warfare Prayer, Pt.2-26 ~ Pt.2-30',
    },
    'issue-09': {
      en: 'Warfare Prayer, Pt.2-31 ~ Pt.2-37 → Warfare Prayer, Pt.3-20 ~ Pt.3-22',
    },
    'issue-10': { en: 'The Bait of Satan, Ch 1-4 → The Bait of Satan, Ch 13-14' },
    'issue-11': {
      en: 'The Fourth Dimension, Parts 1-2 → The Fourth Dimension, Part 4',
    },
    'issue-12': {
      en: 'Breaking Intimidation, Preface ~ Ch 2 → Breaking Intimidation, Ch 5-7',
    },
    'issue-13': {
      en: 'Breaking Intimidation, Ch 8-10 → Breaking Intimidation, Ch 13-14',
    },
    'issue-14': { en: 'Set Yourself Free, Preface ~ Ch 3 → Set Yourself Free, Ch 10-11' },
    'issue-15': { en: 'Discernment, Opening ~ Lesson 2 → Discernment, Lessons 5-6' },
    'issue-16': { en: 'Discernment, Lessons 7-8 → Discernment, Lesson 11 ~ Closing' },
    'issue-17': {
      en: 'Christian History Made Easy, Lessons 1-2 → Christian History Made Easy, Lessons 5-6',
    },
    'issue-18': {
      en: 'Christian History Made Easy, Lessons 7-8 → Christian History Made Easy, Lessons 11-12',
    },
  },
}

function nonEmptyTitle(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** 요청 언어, 한국어 순으로 승인된 체크포인트 제목을 찾는다. */
export function checkpointTitle(setId, checkpointId, lang) {
  if (!Object.prototype.hasOwnProperty.call(binderCheckpointTitles, setId)) return undefined
  const setTitles = binderCheckpointTitles[setId]
  if (!Object.prototype.hasOwnProperty.call(setTitles, checkpointId)) return undefined

  const localized = setTitles[checkpointId]
  if (!localized || typeof localized !== 'object') return undefined
  return nonEmptyTitle(localized[lang]) ?? nonEmptyTitle(localized.ko)
}
