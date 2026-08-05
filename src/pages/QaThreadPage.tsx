import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../authState'
import BackButton from '../components/BackButton'
import LangToggle from '../components/LangToggle'
import { useQaAdmin } from '../hooks/useQaAdmin'
import {
  QaQuestionLengthError,
  qaSubmitErrorMessage,
  QA_QUESTION_MAX,
  useQaSubmit,
} from '../hooks/useQaSubmit'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import {
  markQaAnswerRead,
  readMyPublishedQaThread,
  type QaThread,
  type QaThreadItem,
} from '../qa'

function formatQaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getLang() === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** 게시 답변이 있는데 아직 안 읽었거나, 읽은 뒤 다시 게시된 항목. */
function isUnread(item: QaThreadItem): boolean {
  if (!item.answer) return false
  const readAt = item.question.answerReadAt
  return !readAt || readAt < item.answer.publishedAt
}

export default function QaThreadPage() {
  const { id } = useParams()
  const { loading: authLoading, user, signInWithGoogle, signOut } = useAuth()
  // Q&A는 공개 전 단계 — 목록과 같은 기준으로 관리자만 스레드를 연다.
  const { checking: qaAdminChecking, isAdmin: qaAdmin } = useQaAdmin()
  const { submitting, submit: submitQuestion } = useQaSubmit()
  const userId = user?.id
  const [thread, setThread] = useState<QaThread | undefined>()
  const [followUp, setFollowUp] = useState('')
  const [loading, setLoading] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setThread(undefined)
    setNotFound(false)
    if (!userId || !id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await readMyPublishedQaThread(id)
      if (requestId !== requestRef.current) return
      setThread(result)
      setNotFound(!result)
    } catch (loadError) {
      if (requestId === requestRef.current) {
        if (import.meta.env.DEV) console.warn('Published Q&A thread load failed.', loadError instanceof Error)
        setError(t('qaErrorGeneric'))
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [id, userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current += 1
    }
  }, [load])

  // 스레드를 열면 게시된 답변을 읽은 것으로 표시한다. 실패해도 열람은 막지 않는다.
  useEffect(() => {
    if (!thread) return
    const unread = thread.items.filter(isUnread)
    if (unread.length === 0) return
    void Promise.all(unread.map((item) => markQaAnswerRead(item.question.id))).catch((readError) => {
      if (import.meta.env.DEV) console.warn('Q&A read marker failed.', readError instanceof Error)
    })
  }, [thread])

  const signIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      await signInWithGoogle()
      setSigningIn(false)
    } catch (signInError) {
      if (import.meta.env.DEV) console.warn('Q&A sign-in failed.', signInError instanceof Error)
      setError(t('authLoginFailed'))
      setSigningIn(false)
    }
  }

  const submitFollowUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user || !thread || submitting) return
    setError(null)
    try {
      await submitQuestion({
        userId: user.id,
        question: followUp,
        rootQuestionId: thread.root.id,
      })
      setFollowUp('')
      await load()
    } catch (submitError) {
      if (submitError instanceof QaQuestionLengthError) {
        setError(t('qaQuestionLengthError'))
        return
      }
      setError(qaSubmitErrorMessage(submitError))
    }
  }

  const items = thread?.items ?? []
  // 이어진 질문은 마지막 항목이 승인되었을 때만 받는다 (서버도 같은 조건으로 거부한다).
  const canFollowUp = items.length > 0 && items[items.length - 1].question.status === 'approved'

  // 링크를 감춰도 주소로는 들어올 수 있어, 관리자가 아니면 여기서 되돌린다.
  if (user && !qaAdminChecking && !qaAdmin) return <Navigate to="/" replace />

  return (
    <div className="min-h-full bg-rose-bg text-rose-ink">
      <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <BackButton to="/qa" label={t('navBackList')} />
          <h1 className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold">{t('qaAppTitle')}</h1>
          <div className="flex shrink-0 items-center gap-1">
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

      <main className="mx-auto max-w-3xl px-4 py-5">
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-accent/40 bg-rose-card px-3 py-2.5 text-sm font-bold text-rose-accent">{error}</p>}
        {authLoading ? (
          <p className="py-12 text-center font-serif text-lg font-bold text-rose-key">{t('authChecking')}</p>
        ) : !user ? (
          <section className="rounded-3xl border border-rose-line bg-rose-card p-6 text-center shadow-sm">
            <h2 className="font-serif text-xl font-extrabold">{t('qaLoginTitle')}</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-rose-key">{t('qaThreadLoginHint')}</p>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signingIn}
              className="mt-5 min-h-11 rounded-full bg-rose-accent-deep px-6 py-3 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 focus:outline-none focus:ring-2 focus:ring-rose-accent disabled:opacity-50"
            >
              {signingIn ? t('authGoogleOpening') : t('authGoogleContinue')}
            </button>
          </section>
        ) : qaAdminChecking ? (
          <p className="py-12 text-center font-serif text-lg font-bold text-rose-key">{t('authChecking')}</p>
        ) : loading ? (
          <p className="py-12 text-center font-serif text-lg font-bold text-rose-key">{t('qaLoading')}</p>
        ) : notFound || !thread ? (
          <section className="rounded-2xl border border-dashed border-rose-line bg-rose-card/60 px-4 py-16 text-center">
            <p className="font-serif text-lg font-bold text-rose-key">{t('qaThreadNotFound')}</p>
            <BackButton to="/qa" label={t('navBackList')} className="mt-3" />
          </section>
        ) : (
          <article className="space-y-4">
            {items.map((item, index) => {
              const status = item.question.status
              const pending =
                status === 'submitted' ||
                status === 'drafting' ||
                status === 'draft_ready' ||
                status === 'failed'
              const closed = status === 'rejected'
              const isFollowUp = index > 0

              return (
                <div key={item.question.id} className="space-y-4">
                  {isFollowUp && (
                    <div className="flex items-center gap-3 pt-2" aria-hidden>
                      <span className="h-px flex-1 bg-rose-line" />
                      <span className="text-[10px] font-black tracking-[0.24em] text-rose-key/60">
                        {t('qaFollowUpLabel')}
                      </span>
                      <span className="h-px flex-1 bg-rose-line" />
                    </div>
                  )}

                  <section className="rounded-3xl border border-rose-line bg-rose-card p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-black text-rose-key">
                        {isFollowUp ? t('qaFollowUpLabel') : t('qaQuestionLabel')}
                      </span>
                      <span className="text-xs font-bold text-rose-key/70">{formatQaDate(item.question.createdAt)}</span>
                    </div>
                    <h2 className="mt-3 whitespace-pre-wrap font-serif text-xl font-extrabold leading-8 text-rose-ink">
                      {item.question.question}
                    </h2>
                  </section>

                  {item.answer ? (
                    <section className="rounded-3xl border border-leaf-soft bg-rose-card p-5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-serif text-xl font-extrabold text-leaf-deep">{t('qaPastorAnswer')}</h2>
                        <span className="rounded-full bg-leaf-pale/70 px-2.5 py-1 text-xs font-black text-leaf-deep">✓ {t('qaStatusAnswered')}</span>
                      </div>
                      <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-rose-ink">{item.answer.body}</p>
                      {item.citations.length > 0 && (
                        <section className="mt-5 border-t border-rose-line pt-4">
                          <h3 className="font-serif text-base font-extrabold text-rose-ink">{t('qaCitations')}</h3>
                          <ol className="mt-2 space-y-2.5">
                            {item.citations.map((citation) => (
                              <li key={citation.id} className="rounded-xl bg-rose-chip/45 px-3 py-2.5 text-sm leading-6 text-rose-key">
                                <p className="font-black text-rose-ink">[{citation.ordinal + 1}] {citation.sourceTitle}</p>
                                <p className="mt-0.5">{citation.excerpt}</p>
                                {citation.sourceUrl && (
                                  <a
                                    href={citation.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-flex min-h-11 items-center font-bold text-rose-accent underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-rose-accent"
                                  >
                                    {t('qaOpenSource')}
                                  </a>
                                )}
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}
                    </section>
                  ) : pending ? (
                    <section role="status" className="rounded-3xl border border-rose-line bg-rose-card p-6 text-center shadow-sm">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-chip text-xl text-rose-accent-deep" aria-hidden>⌛</div>
                      <h2 className="mt-3 font-serif text-xl font-extrabold text-rose-ink">{t('qaPendingTitle')}</h2>
                      <p className="mx-auto mt-2 max-w-lg text-sm font-bold leading-6 text-rose-key">
                        {isFollowUp ? t('qaFollowUpPendingHint') : t('qaPendingHint')}
                      </p>
                    </section>
                  ) : closed ? (
                    <section role="status" className="rounded-3xl border border-rose-line bg-rose-card p-6 text-center shadow-sm">
                      <h2 className="font-serif text-xl font-extrabold text-rose-ink">{t('qaClosedTitle')}</h2>
                      <p className="mx-auto mt-2 max-w-lg text-sm font-bold leading-6 text-rose-key">{t('qaClosedHint')}</p>
                    </section>
                  ) : null}
                </div>
              )
            })}

            {canFollowUp && (
              <form onSubmit={submitFollowUp} className="rounded-3xl border border-rose-line bg-rose-card p-4 shadow-sm sm:p-5">
                <label htmlFor="qa-follow-up" className="block font-serif text-lg font-extrabold text-rose-ink">
                  {t('qaFollowUpAsk')}
                </label>
                <p id="qa-follow-up-hint" className="mt-1 text-xs font-bold leading-5 text-rose-key">{t('qaFollowUpHint')}</p>
                <textarea
                  id="qa-follow-up"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  maxLength={QA_QUESTION_MAX}
                  rows={4}
                  placeholder={t('qaFollowUpPlaceholder')}
                  aria-describedby="qa-follow-up-hint qa-follow-up-count"
                  className="mt-3 block w-full resize-y rounded-2xl border border-rose-line bg-white p-4 text-base leading-7 text-rose-ink outline-none placeholder:text-rose-key/60 focus:border-rose-accent focus:ring-2 focus:ring-rose-accent"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span id="qa-follow-up-count" className="text-xs font-bold tabular-nums text-rose-key/70">
                    {t('qaCharacterCount')(followUp.length, QA_QUESTION_MAX)}
                  </span>
                  <button
                    type="submit"
                    disabled={submitting || followUp.trim().length < 2}
                    className="min-h-11 rounded-full bg-rose-accent-deep px-6 py-2.5 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-rose-accent focus:ring-offset-2 focus:ring-offset-rose-card disabled:opacity-50"
                  >
                    {submitting ? t('qaSubmitting') : t('qaFollowUpSubmit')}
                  </button>
                </div>
              </form>
            )}
          </article>
        )}
      </main>
    </div>
  )
}
