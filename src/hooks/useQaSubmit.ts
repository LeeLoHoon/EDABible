import { useRef, useState } from 'react'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { QaIdempotencyConflictError, submitQaQuestion, type QaQuestion } from '../qa'

// 새 질문과 이어진 질문이 같은 제출 규칙(길이 검증·중복 방지·충돌 재시도)을 쓰도록 한곳에 모은다.
const QA_PENDING_TOKEN_PREFIX = 'edabible:qa-submit-token:v2:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const QA_QUESTION_MIN = 2
export const QA_QUESTION_MAX = 4000

interface PendingQaSubmission {
  token: string
  question: string
  lang: 'ko' | 'en'
  rootQuestionId?: string
}

/** 스레드마다 별도 토큰을 쓴다 — 루트와 이어진 질문의 중복 방지 표시가 섞이지 않게 한다. */
function pendingTokenKey(userId: string, rootQuestionId?: string): string {
  return `${QA_PENDING_TOKEN_PREFIX}${userId}${rootQuestionId ? `:${rootQuestionId}` : ''}`
}

function readPendingSubmission(userId: string, rootQuestionId?: string): PendingQaSubmission | undefined {
  try {
    const raw = sessionStorage.getItem(pendingTokenKey(userId, rootQuestionId))
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('token' in value) ||
      typeof value.token !== 'string' ||
      !UUID_PATTERN.test(value.token) ||
      !('question' in value) ||
      typeof value.question !== 'string' ||
      !('lang' in value) ||
      (value.lang !== 'ko' && value.lang !== 'en')
    ) return undefined
    return {
      token: value.token,
      question: value.question,
      lang: value.lang,
      ...(rootQuestionId ? { rootQuestionId } : {}),
    }
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be read.', storageError instanceof Error)
    return undefined
  }
}

function writePendingSubmission(userId: string, pending: PendingQaSubmission): void {
  try {
    sessionStorage.setItem(pendingTokenKey(userId, pending.rootQuestionId), JSON.stringify(pending))
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be saved.', storageError instanceof Error)
  }
}

function clearPendingToken(userId: string, rootQuestionId?: string): void {
  try {
    sessionStorage.removeItem(pendingTokenKey(userId, rootQuestionId))
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be cleared.', storageError instanceof Error)
  }
}

export interface QaSubmitState {
  submitting: boolean
  /** 검증 실패나 제출 실패 사유. 화면 문구는 호출측이 정한다. */
  submit: (input: { userId: string; question: string; rootQuestionId?: string }) => Promise<QaQuestion>
}

export class QaQuestionLengthError extends Error {
  constructor() {
    super('QA_INVALID_QUESTION')
    this.name = 'QaQuestionLengthError'
  }
}

/** 질문 제출 실패 문구 — 새 질문과 이어진 질문이 같은 안내를 쓴다. */
export function qaSubmitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('QA_RATE_LIMIT_HOUR')) return t('qaRateLimitHour')
  if (message.includes('QA_RATE_LIMIT_DAY')) return t('qaRateLimitDay')
  if (message.includes('QA_INVALID_QUESTION')) return t('qaQuestionLengthError')
  if (message.includes('QA_INVALID_PARENT')) return t('qaFollowUpUnavailable')
  if (error instanceof QaIdempotencyConflictError || message.includes('QA_IDEMPOTENCY_CONFLICT')) {
    return t('qaIdempotencyConflict')
  }
  return t('qaErrorGeneric')
}

export function useQaSubmit(): QaSubmitState {
  const [submitting, setSubmitting] = useState(false)
  // sessionStorage를 못 쓰는 환경(사파리 프라이빗 등)에서도 같은 토큰을 유지한다.
  const fallbackRef = useRef<Record<string, PendingQaSubmission>>({})

  const submit = async ({
    userId,
    question,
    rootQuestionId,
  }: {
    userId: string
    question: string
    rootQuestionId?: string
  }): Promise<QaQuestion> => {
    const normalized = question.trim()
    if (normalized.length < QA_QUESTION_MIN || normalized.length > QA_QUESTION_MAX) {
      throw new QaQuestionLengthError()
    }

    const cacheKey = pendingTokenKey(userId, rootQuestionId)
    const lang = getLang()
    const previous = readPendingSubmission(userId, rootQuestionId) ?? fallbackRef.current[cacheKey]
    const pending: PendingQaSubmission =
      previous?.question === normalized && previous.lang === lang
        ? previous
        : {
            token: crypto.randomUUID(),
            question: normalized,
            lang,
            ...(rootQuestionId ? { rootQuestionId } : {}),
          }

    fallbackRef.current[cacheKey] = pending
    writePendingSubmission(userId, pending)
    setSubmitting(true)
    try {
      const created = await submitQaQuestion({
        question: normalized,
        lang,
        clientToken: pending.token,
        ...(rootQuestionId ? { rootQuestionId } : {}),
      })
      clearPendingToken(userId, rootQuestionId)
      delete fallbackRef.current[cacheKey]
      return created
    } catch (submitError) {
      // 토큰이 이미 쓰였다면 새 토큰으로 갈아끼워 다음 시도가 통과하게 한다.
      if (
        submitError instanceof QaIdempotencyConflictError ||
        (submitError instanceof Error && submitError.message.includes('QA_IDEMPOTENCY_CONFLICT'))
      ) {
        const retry = { ...pending, token: crypto.randomUUID() }
        fallbackRef.current[cacheKey] = retry
        writePendingSubmission(userId, retry)
      }
      throw submitError
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, submit }
}
