import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../authState'
import BackButton from '../components/BackButton'
import LangToggle from '../components/LangToggle'
import QaAdminPanel from '../components/QaAdminPanel'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import {
  isQaAdmin,
  listMyQaQuestions,
  QaIdempotencyConflictError,
  submitQaQuestion,
  type QaQuestion,
  type QaQuestionStatus,
} from '../qa'

const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_WINDOW_MS = 2_000
const QA_PENDING_TOKEN_PREFIX = 'edabible:qa-submit-token:v2:'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function pendingTokenKey(userId: string): string {
  return `${QA_PENDING_TOKEN_PREFIX}${userId}`
}

interface PendingQaSubmission {
  token: string
  question: string
  lang: 'ko' | 'en'
}

function readPendingSubmission(userId: string): PendingQaSubmission | undefined {
  try {
    const raw = sessionStorage.getItem(pendingTokenKey(userId))
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
    return { token: value.token, question: value.question, lang: value.lang }
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be read.', storageError instanceof Error)
    return undefined
  }
}

function writePendingSubmission(userId: string, pending: PendingQaSubmission): void {
  try {
    sessionStorage.setItem(pendingTokenKey(userId), JSON.stringify(pending))
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be saved.', storageError instanceof Error)
  }
}

function clearPendingToken(userId: string): void {
  try {
    sessionStorage.removeItem(pendingTokenKey(userId))
  } catch (storageError) {
    if (import.meta.env.DEV) console.warn('Q&A idempotency marker could not be cleared.', storageError instanceof Error)
  }
}

function formatQaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getLang() === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function userStatusLabel(status: QaQuestionStatus): string {
  if (status === 'approved') return t('qaStatusAnswered')
  if (status === 'rejected') return t('qaStatusClosed')
  return t('qaStatusPending')
}

function submitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('QA_RATE_LIMIT_HOUR')) return t('qaRateLimitHour')
  if (message.includes('QA_RATE_LIMIT_DAY')) return t('qaRateLimitDay')
  if (message.includes('QA_INVALID_QUESTION')) return t('qaQuestionLengthError')
  if (error instanceof QaIdempotencyConflictError || message.includes('QA_IDEMPOTENCY_CONFLICT')) {
    return t('qaIdempotencyConflict')
  }
  return t('qaErrorGeneric')
}

export default function QaPage() {
  const navigate = useNavigate()
  const { authError, loading: authLoading, user, signInWithGoogle, signOut } = useAuth()
  const userId = user?.id
  const [questions, setQuestions] = useState<QaQuestion[]>([])
  const [question, setQuestion] = useState('')
  const [adminModeUserId, setAdminModeUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const adminTapRef = useRef({ count: 0, deadline: 0 })
  const clientSubmissionsRef = useRef<Record<string, PendingQaSubmission>>({})
  const questionsRequestRef = useRef(0)
  const adminMode = adminModeUserId !== null && adminModeUserId === userId

  const reload = useCallback(async () => {
    const requestId = ++questionsRequestRef.current
    if (!userId) {
      setQuestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await listMyQaQuestions()
      if (requestId === questionsRequestRef.current) setQuestions(next)
    } catch (loadError) {
      if (requestId === questionsRequestRef.current) setError(submitErrorMessage(loadError))
    } finally {
      if (requestId === questionsRequestRef.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      questionsRequestRef.current += 1
    }
  }, [reload])

  const handleAdminTap = () => {
    const tapTime = performance.now()
    const taps = adminTapRef.current
    if (tapTime > taps.deadline) {
      taps.count = 1
      taps.deadline = tapTime + ADMIN_TAP_WINDOW_MS
      return
    }
    taps.count += 1
    if (taps.count < ADMIN_TAP_COUNT) return
    taps.count = 0
    taps.deadline = 0
    if (!userId) return

    void isQaAdmin().then((allowed) => {
      if (!allowed) return
      setAdminModeUserId(adminMode ? null : userId)
      navigator.vibrate?.(40)
    })
  }

  const signIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      await signInWithGoogle()
      setSigningIn(false)
    } catch (signInError) {
      setError(submitErrorMessage(signInError))
      setSigningIn(false)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user || submitting) return
    const normalized = question.trim()
    if (normalized.length < 2 || normalized.length > 4000) {
      setError(t('qaQuestionLengthError'))
      return
    }

    setSubmitting(true)
    setError(null)
    const lang = getLang()
    const previous = readPendingSubmission(user.id) ?? clientSubmissionsRef.current[user.id]
    const pending: PendingQaSubmission =
      previous?.question === normalized && previous.lang === lang
        ? previous
        : { token: crypto.randomUUID(), question: normalized, lang }
    clientSubmissionsRef.current[user.id] = pending
    writePendingSubmission(user.id, pending)
    try {
      const created = await submitQaQuestion({
        question: normalized,
        lang,
        clientToken: pending.token,
      })
      clearPendingToken(user.id)
      delete clientSubmissionsRef.current[user.id]
      setQuestion('')
      navigate(`/qa/${created.id}`)
    } catch (submitError) {
      if (
        submitError instanceof QaIdempotencyConflictError ||
        (submitError instanceof Error && submitError.message.includes('QA_IDEMPOTENCY_CONFLICT'))
      ) {
        const retry = { ...pending, token: crypto.randomUUID() }
        clientSubmissionsRef.current[user.id] = retry
        writePendingSubmission(user.id, retry)
      }
      setError(submitErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full bg-rose-bg text-rose-ink">
      <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <BackButton to="/" label={t('navBackHome')} />
          <h1 onClick={handleAdminTap} className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">
            {t('qaAppTitle')}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            {adminMode && (
              <button
                type="button"
                onClick={() => setAdminModeUserId(null)}
                className="flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-rose-accent-deep px-2.5 py-2 text-xs font-extrabold text-white shadow-sm shadow-rose-accent/25 focus:outline-none focus:ring-2 focus:ring-rose-accent sm:px-3"
                aria-label={t('qaAdminExit')}
              >
                <span aria-hidden>🛡</span>
                <span className="hidden sm:inline">{t('qaAdminExit')}</span>
                <span aria-hidden className="sm:hidden">✕</span>
              </button>
            )}
            <LangToggle />
            {user && (
              <button
                type="button"
                onClick={() => void signOut()}
                className="min-h-11 rounded-full px-2 text-[13px] font-bold text-rose-key transition hover:text-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent"
              >
                {t('qaLogout')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        <section className="relative overflow-hidden rounded-3xl border border-rose-line bg-rose-card px-5 py-6 shadow-sm">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full bg-rose-chip/70 blur-xl" />
          <div className="relative">
            <p className="text-[10px] font-black tracking-[0.28em] text-rose-accent-deep">{t('qaEyebrow')}</p>
            <h2 className="mt-2 max-w-xl font-serif text-2xl font-extrabold leading-tight text-rose-ink">
              {t('qaHeading')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-rose-key">{t('qaIntro')}</p>
          </div>
        </section>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-accent/40 bg-rose-card px-3 py-2.5 text-sm font-bold text-rose-accent">
            {error}
          </p>
        )}

        {authLoading ? (
          <p className="py-12 text-center font-serif text-lg font-bold text-rose-key">{t('authChecking')}</p>
        ) : !user ? (
          <section className="rounded-3xl border border-rose-line bg-rose-card p-6 text-center shadow-sm">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-chip text-2xl text-rose-accent-deep" aria-hidden>
              ?
            </div>
            <h2 className="mt-4 font-serif text-xl font-extrabold text-rose-ink">{t('qaLoginTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-rose-key">{t('qaLoginHint')}</p>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signingIn}
              className="mt-5 min-h-11 rounded-full bg-rose-accent-deep px-6 py-3 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-rose-accent focus:ring-offset-2 focus:ring-offset-rose-bg disabled:opacity-50"
            >
              {signingIn ? t('authGoogleOpening') : t('authGoogleContinue')}
            </button>
            {authError && <p className="mt-3 text-sm font-bold text-rose-accent">{t('authCheckFailed')}</p>}
          </section>
        ) : loading ? (
          <p className="py-12 text-center font-serif text-lg font-bold text-rose-key">{t('qaLoading')}</p>
        ) : adminMode ? (
          <QaAdminPanel />
        ) : (
          <>
            <form onSubmit={submit} className="rounded-3xl border border-rose-line bg-rose-card p-4 shadow-sm sm:p-5">
              <label htmlFor="qa-question" className="block font-serif text-lg font-extrabold text-rose-ink">
                {t('qaAskLabel')}
              </label>
              <p id="qa-question-hint" className="mt-1 text-xs font-bold leading-5 text-rose-key">{t('qaAskHint')}</p>
              <textarea
                id="qa-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={4000}
                rows={6}
                placeholder={t('qaQuestionPlaceholder')}
                aria-describedby="qa-question-hint qa-question-count"
                className="mt-3 block w-full resize-y rounded-2xl border border-rose-line bg-white p-4 text-base leading-7 text-rose-ink outline-none placeholder:text-rose-key/60 focus:border-rose-accent focus:ring-2 focus:ring-rose-accent"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span id="qa-question-count" className="text-xs font-bold tabular-nums text-rose-key/70">
                  {t('qaCharacterCount')(question.length, 4000)}
                </span>
                <button
                  type="submit"
                  disabled={submitting || question.trim().length < 2}
                  className="min-h-11 rounded-full bg-rose-accent-deep px-6 py-2.5 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-rose-accent focus:ring-offset-2 focus:ring-offset-rose-card disabled:opacity-50"
                >
                  {submitting ? t('qaSubmitting') : t('qaSubmit')}
                </button>
              </div>
            </form>

            <section aria-labelledby="qa-my-questions" className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 id="qa-my-questions" className="font-serif text-xl font-extrabold text-rose-ink">{t('qaMyQuestions')}</h2>
                <span className="h-px flex-1 bg-rose-line" aria-hidden />
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="min-h-11 rounded-full px-3 text-sm font-bold text-rose-key transition hover:text-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent"
                >
                  {t('qaRefresh')}
                </button>
              </div>
              {questions.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-rose-line bg-rose-card/60 px-4 py-12 text-center text-sm font-bold text-rose-key">
                  {t('qaMyQuestionsEmpty')}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {questions.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={`/qa/${item.id}`}
                        className="group flex min-h-11 items-center gap-3 rounded-2xl border border-rose-line bg-rose-card px-4 py-3.5 transition hover:border-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 block font-serif text-[16px] font-bold leading-6 text-rose-ink">{item.question}</span>
                          <span className="mt-1 block text-xs font-bold text-rose-key/70">{formatQaDate(item.createdAt)}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${item.status === 'approved' ? 'bg-leaf-pale/70 text-leaf-deep' : item.status === 'rejected' ? 'bg-rose-bg text-rose-accent' : 'bg-rose-chip text-rose-key'}`}>
                          {userStatusLabel(item.status)}
                        </span>
                        <span aria-hidden className="text-lg text-rose-key transition group-hover:text-rose-accent">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
