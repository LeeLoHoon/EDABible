/** YouTube video ID 형식이다. */
export const YOUTUBE_ID_RE = /^[\w-]{11}$/

/** 바인더 세트별 요약 영상 단계다. */
export const binderVideos = {
  'spl-timothy': [
    {
      stage: '01',
      page: 3,
      lessons: [
        { no: 1, page: 4, title: '고구마 전도왕 김기동 집사 간증', videoId: '3T-MIu9LBlk' },
        { no: 2, page: 6, title: '1-1. 이재철 목사님 - 하나님은 누구신가', videoId: 'Mo0r4LdkwCc' },
        { no: 3, page: 8, title: '1-2. 박효진 장로님 - 영적전쟁', videoId: 'biQ6lIr_eCE' },
        { no: 4, page: 10, title: '2-1. 이재철 목사님 - 나는 누구인가', videoId: '8lHjRm9kENc' },
      ],
    },
    {
      stage: '02',
      page: 15,
      lessons: [
        { no: 5, page: 16, title: '2-2. 박효진 장로님 - 사랑은 허다한 죄를', videoId: 'yjUQhfyUb4E' },
        { no: 6, page: 18, title: '3-1. 이재철 목사님 - 예수님은 누구신가', videoId: 'vstC1C-Dqis' },
        { no: 7, page: 20, title: '3-2. 박효진 장로님 - 하나님의 성전', videoId: 'a8bRdhnfHFE' },
        { no: 8, page: 22, title: '4-1. 이재철 목사님 - 성령님은 누구신가', videoId: 'xcsUQqPmSMk' },
      ],
    },
    {
      stage: '03',
      page: 27,
      lessons: [
        { no: 9, page: 28, title: '4-2. 박효진 장로님 - 잃어버린 도끼', videoId: '_lYQ4euZ9Co' },
        { no: 10, page: 30, title: '5-1. 이재철 목사님 - 성경이란', videoId: 'dnUhUJiBg_U' },
        { no: 11, page: 32, title: '5-2. 박효진 장로님 - 강청', videoId: 'J7_MfP6jpd4' },
        { no: 12, page: 34, title: '6-1. 이재철 목사님 - 기도란', videoId: 'Y0oeD3tzN64' },
      ],
    },
    {
      stage: '04',
      page: 39,
      lessons: [
        { no: 13, page: 40, title: '6-2. 박효진 장로님 - 독방의 예배', videoId: 'fVlkgC98t3Q' },
        { no: 14, page: 42, title: '7-1. 이재철 목사님 - 교회란', videoId: 'dEZx8xgVPBI' },
        { no: 15, page: 44, title: '7-2. 박효진 장로님 - 나와 내 집은', videoId: 'C1xgZUNNLvg' },
        { no: 16, page: 46, title: '8-1. 이재철 목사님 - 예배란', videoId: 'QMmHWjZ4WPk' },
      ],
    },
    {
      stage: '05',
      page: 51,
      lessons: [
        { no: 17, page: 52, title: '8-2. 박효진 장로님 - 사형선고', videoId: 'OWMR-ku1r7w' },
        { no: 18, page: 54, title: '9. 이재철 목사님 - 그리스도인의 교회 생활', videoId: 'ZTGSFLY1YI8' },
        { no: 19, page: 56, title: '10. 이재철 목사님 - 그리스도인의 가정 생활', videoId: 'oLQyxBQLVE8' },
        { no: 20, page: 58, title: '원종수 목사님 간증 1', videoId: 'xErNGewD4T0' },
      ],
    },
    {
      stage: '06',
      page: 63,
      lessons: [
        { no: 21, page: 64, title: '원종수 목사님 간증 2', videoId: 'zUBMyEYP_Aw' },
        { no: 22, page: 66, title: '율법과 복음 1', videoId: 'tiEo-hGp-eU' },
        { no: 23, page: 68, title: '율법과 복음 2', videoId: '6QR1w1MPVu8' },
        { no: 24, page: 70, title: '율법과 복음 3', videoId: 'v4UolJjaNUo' },
      ],
    },
    {
      stage: '07',
      page: 75,
      lessons: [
        { no: 25, page: 76, title: '율법과 복음 4', videoId: 'SS674RgWHJs' },
        { no: 26, page: 78, title: '율법과 복음 5', videoId: 's8ontVQFvcM' },
        { no: 27, page: 80, title: '율법과 복음 6', videoId: 'XBo7y5t23Ec' },
        { no: 28, page: 82, title: '율법과 복음 7', videoId: 'sY-fBE0Ug34' },
      ],
    },
    {
      stage: '08',
      page: 87,
      lessons: [
        { no: 29, page: 88, title: '율법과 복음 8', videoId: '59OlvSZr320' },
        { no: 30, page: 90, title: '율법과 복음 9', videoId: 'ABTeZ4vUVzI' },
        { no: 31, page: 92, title: '율법과 복음 10', videoId: 'xa6OUqbs0Mo' },
        { no: 32, page: 94, title: '율법과 복음 11', videoId: 'T1zlZPOTT0o' },
      ],
    },
    {
      stage: '09',
      page: 99,
      lessons: [
        { no: 33, page: 100, title: '율법과 복음 12', videoId: 'enTdtykiv20' },
        { no: 34, page: 102, title: '율법과 복음 13', videoId: '4PQp20pndzU' },
        { no: 35, page: 104, title: '평범한 사람들 - 하나님의 자존심', videoId: 'uaBNQsi7B5M' },
        { no: 36, page: 106, title: '신앙과 양육 - 자녀교육과 교회생활', videoId: 'soPlYNDzFgg' },
      ],
    },
    {
      stage: '10',
      page: 111,
      lessons: [
        { no: 37, page: 112, title: '가정과 부부 - 사랑하는 누이야 함께 가자', videoId: 'eRgTBWmETJw' },
        { no: 38, page: 114, title: '재정과 믿음 - 너희가 먹을 것을 주어라', videoId: 'irXtPeGZs2w' },
        { no: 39, page: 116, title: '기도와 비전 - 세계를 그대 품 안에', videoId: 'slV36J6tH6I' },
        { no: 40, page: 118, title: '너희는 이렇게 기도하라 1', videoId: 'bQsOuT8YhHg' },
      ],
    },
    {
      stage: '11',
      page: 123,
      lessons: [
        { no: 41, page: 124, title: '너희는 이렇게 기도하라 2', videoId: 'p5y3cD7eCVU' },
        { no: 42, page: 126, title: '너희는 이렇게 기도하라 3', videoId: 'kVBsg4bco9E' },
        { no: 43, page: 128, title: '너희는 이렇게 기도하라 4', videoId: 'ic6XZb5wj0M' },
        { no: 44, page: 130, title: '너희는 이렇게 기도하라 5', videoId: 'Kn4Umo2_psM' },
      ],
    },
    {
      stage: '12',
      page: 135,
      lessons: [
        { no: 45, page: 136, title: '너희는 이렇게 기도하라 6', videoId: 'F3QtsQs5h5Y' },
        { no: 46, page: 138, title: '너희는 이렇게 기도하라 7', videoId: 'wU7nxUa4i-Y' },
        { no: 47, page: 140, title: '전도 1. 전도는 왜 해야 하나', videoId: 'bUPuMaXmNSE' },
        { no: 48, page: 142, title: '전도 2. 전도는 성도의 의무', videoId: 'z45sAgk7N4E' },
      ],
    },
    {
      stage: '13',
      page: 147,
      lessons: [
        { no: 49, page: 148, title: '전도 3. 어떻게 전도할 것인가', videoId: '21ZuKgJ2g6M' },
        { no: 50, page: 150, title: '전도 4. 전도에 프로가 되자', videoId: 'AC7sn4dmNnM' },
        { no: 51, page: 152, title: '전도 5. 교제에 프로가 되자 (1)', videoId: 'V4xzGilQAh0' },
        { no: 52, page: 154, title: '전도 6. 교제에 프로가 되자 (2)', videoId: 'Bq2P2YWJDl8' },
      ],
    },
    {
      stage: '14',
      page: 159,
      lessons: [
        { no: 53, page: 160, title: '기도 없이 능력 없다 1', videoId: 'G38JHeM5u6o' },
        { no: 54, page: 162, title: '기도 없이 능력 없다 2', videoId: 'siWE1Yz4I94' },
        { no: 55, page: 164, title: '영적 단계와 치유 1', videoId: 'Iy5YvyHK2G0' },
        { no: 56, page: 166, title: '영적 단계와 치유 2', videoId: 'ByGLGo8nFR0' },
      ],
    },
    {
      stage: '15',
      page: 171,
      lessons: [
        { no: 57, page: 172, title: '영적 단계와 치유 3', videoId: 'z5ncWlx2wPo' },
        { no: 58, page: 174, title: '영적 단계와 치유 4', videoId: 'D14BV8d5Yb8' },
        { no: 59, page: 176, title: '영적 단계와 치유 5', videoId: 'JygFTqfbr40' },
        { no: 60, page: 178, title: '영적 단계와 치유 6', videoId: 'qe-jb9Jq2hE' },
      ],
    },
    {
      stage: '16',
      page: 183,
      lessons: [
        { no: 61, page: 184, title: '영적 단계와 치유 7', videoId: 'oFEeBhtk-uw' },
        { no: 62, page: 186, title: '영적 단계와 치유 8', videoId: 'uf3aPCX5rBE' },
        { no: 63, page: 188, title: '사명자반 1. 믿음의 재정립', videoId: 'GLZnrFv_WHI' },
        { no: 64, page: 190, title: '사명자반 2. 사명자란', videoId: 'nNivgsshdTg' },
      ],
    },
    {
      stage: '17',
      page: 195,
      lessons: [
        { no: 65, page: 196, title: '사명자반 3. 사명자의 조건', videoId: 'uy39Yz7YbYs' },
        { no: 66, page: 198, title: '사명자반 4. 복음과 사명자행전의 연결고리 (1)', videoId: 'y99HjwHYZHw' },
        { no: 67, page: 200, title: '사명자반 5. 복음과 사명자행전의 연결고리 (2)', videoId: '2A54rX9BviM' },
        { no: 68, page: 202, title: '사명자반 6. 복음과 사명자행전의 연결고리 (3)', videoId: 'gNQJD4RwSt0' },
      ],
    },
    {
      stage: '18',
      page: 207,
      lessons: [
        { no: 69, page: 208, title: '사명자반 7. 사명자 노아', videoId: 'XzBCf58otSI' },
        { no: 70, page: 210, title: '사명자반 8. 사명자 모세', videoId: '9D1uiWhmL2s' },
        { no: 71, page: 212, title: '사명자반 9. 사명자 예수님', videoId: 'UerTmGEe8DE' },
        { no: 72, page: 214, title: '사명자반 10. 그날이 오면', videoId: 'v-G1DaG6sCg' },
      ],
    },
  ],
}

/** 등록된 바인더 세트의 요약 영상 단계만 반환한다. */
export function videoStagesFor(setId) {
  return Object.prototype.hasOwnProperty.call(binderVideos, setId) && Array.isArray(binderVideos[setId])
    ? binderVideos[setId]
    : undefined
}

/** 현재 쪽에 해당하는 마지막 시작 단계를 찾는다. */
export function currentVideoStage(setId, page) {
  const stages = videoStagesFor(setId)
  if (!stages || stages.length === 0) return undefined

  let current = stages[0]
  for (const stage of stages) {
    if (stage.page > page) break
    current = stage
  }
  return current
}

/** 느낀점 쪽 바로 앞에 표시할 영상 과를 찾는다. */
export function lessonVideoBeforePage(setId, page) {
  const stages = videoStagesFor(setId)
  if (!stages) return undefined

  for (const stage of stages) {
    const lesson = stage.lessons.find(
      (item) => item.page === page && YOUTUBE_ID_RE.test(item.videoId),
    )
    if (lesson) return { stage, lesson }
  }
  return undefined
}
