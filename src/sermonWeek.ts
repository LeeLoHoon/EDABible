/* 주간 말씀 묵상의 주차 계산.
   설교는 주일(preachedOn)에 이뤄지고, 묵상 기간은 그 다음 날 월요일부터 토요일까지다.
   날짜는 전부 로컬 시간 기준 'YYYY-MM-DD' 키로 다룬다 — types.ts의 todayKey와 같은 규칙이라
   문자열 비교만으로 순서를 판정할 수 있다. */

import { todayKey } from './types'

/** 'YYYY-MM-DD' → 로컬 자정 Date. new Date('2026-07-26')의 UTC 파싱을 피한다. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  // 2월 30일 같은 값은 다음 달로 넘어가므로 되돌려 확인한다
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export function isSunday(key: string): boolean {
  return parseDateKey(key)?.getDay() === 0
}

/** 당일이 주일이면 당일을 그대로 돌려준다 — 그 설교의 묵상은 내일부터 시작이다 */
export function mostRecentSundayKey(now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay(): 0 = 일요일
  return todayKey(addDays(today, -today.getDay()))
}

export interface MeditationPeriod {
  /** 묵상 시작 — 설교 다음 날 월요일 */
  start: string
  /** 묵상 끝 — 그 주 토요일. 지나도 잠기지 않는다(안내용) */
  end: string
}

export function meditationPeriod(preachedOn: string): MeditationPeriod | null {
  const sunday = parseDateKey(preachedOn)
  if (!sunday) return null
  return { start: todayKey(addDays(sunday, 1)), end: todayKey(addDays(sunday, 6)) }
}

/** 묵상 기간 안에 있는지 — 진도 압박용이 아니라 '이번 주' 배지 표시에만 쓴다 */
export function isWithinMeditationPeriod(preachedOn: string, now: Date): boolean {
  const period = meditationPeriod(preachedOn)
  if (!period) return false
  const today = todayKey(now)
  return today >= period.start && today <= period.end
}

/**
 * 게시된 설교 날짜들 중 '이번 주 말씀'으로 보여줄 주일을 고른다.
 * 아직 오지 않은 주일은 제외하고, 직전 주일 설교가 아직 안 올라왔으면 그 이전 것으로
 * 자연스럽게 내려간다 — 빈 화면을 만들지 않기 위한 폴백이다.
 */
export function pickCurrentPreachedOn(preachedOnList: readonly string[], now: Date): string | null {
  const today = todayKey(now)
  let picked: string | null = null
  for (const key of preachedOnList) {
    if (key > today) continue
    if (picked === null || key > picked) picked = key
  }
  return picked
}
