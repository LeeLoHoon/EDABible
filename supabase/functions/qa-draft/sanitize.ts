export type QaFailureCode = 'timeout' | 'provider_error' | 'retrieval_error' | 'internal_error'

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

export function insufficientEvidenceMessage(lang: 'ko' | 'en'): string {
  return lang === 'en'
    ? 'There is not enough approved evidence to create a draft answer.'
    : '관련 승인 자료가 충분하지 않아 답변 초안을 만들 수 없습니다.'
}

export function sanitizeDraftBody(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return character === '\n' || character === '\r' || character === '\t' || (code >= 32 && code !== 127)
    })
    .join('')
    .trim()
    .slice(0, 30000)
}

export function failureCodeFor(error: unknown): QaFailureCode {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  if (error instanceof Error && error.message.startsWith('QA_PROVIDER')) return 'provider_error'
  if (error instanceof Error && error.message.startsWith('QA_ANTHROPIC')) return 'provider_error'
  if (error instanceof Error && error.message.startsWith('QA_RETRIEVAL')) return 'retrieval_error'
  return 'internal_error'
}

export function publicErrorMessage(code: QaFailureCode): string {
  if (code === 'timeout') return 'QA_DRAFT_TIMEOUT'
  if (code === 'provider_error') return 'QA_DRAFT_PROVIDER_ERROR'
  if (code === 'retrieval_error') return 'QA_DRAFT_RETRIEVAL_ERROR'
  return 'QA_DRAFT_FAILED'
}
