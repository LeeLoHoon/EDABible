import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../authState'
import BackButton from '../components/BackButton'
import LangToggle from '../components/LangToggle'
import { useQaAdmin } from '../hooks/useQaAdmin'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { readMyPublishedQaThread, type QaThread } from '../qa'

function formatQaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getLang() === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function QaThreadPage() {
  const { id } = useParams()
  const { loading: authLoading, user, signInWithGoogle, signOut } = useAuth()
  // Q&A는 공개 전 단계 — 목록과 같은 기준으로 관리자만 스레드를 연다.
  const { checking: qaAdminChecking, isAdmin: qaAdmin } = useQaAdmin()
  const userId = user?.id
  const [thread, setThread] = useState<QaThread | undefined>()
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

  const status = thread?.question.status
  const pending =
    status === 'submitted' ||
    status === 'drafting' ||
    status === 'draft_ready' ||
    status === 'failed'
  const closed = status === 'rejected'

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
            <section className="rounded-3xl border border-rose-line bg-rose-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-rose-chip px-2.5 py-1 text-xs font-black text-rose-key">{t('qaQuestionLabel')}</span>
                <span className="text-xs font-bold text-rose-key/70">{formatQaDate(thread.question.createdAt)}</span>
              </div>
              <h2 className="mt-3 whitespace-pre-wrap font-serif text-xl font-extrabold leading-8 text-rose-ink">{thread.question.question}</h2>
            </section>

            {thread.answer ? (
              <section className="rounded-3xl border border-leaf-soft bg-rose-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-serif text-xl font-extrabold text-leaf-deep">{t('qaPastorAnswer')}</h2>
                  <span className="rounded-full bg-leaf-pale/70 px-2.5 py-1 text-xs font-black text-leaf-deep">✓ {t('qaStatusAnswered')}</span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-rose-ink">{thread.answer.body}</p>
                {thread.citations.length > 0 && (
                  <section className="mt-5 border-t border-rose-line pt-4" aria-labelledby="qa-citations-title">
                    <h3 id="qa-citations-title" className="font-serif text-base font-extrabold text-rose-ink">{t('qaCitations')}</h3>
                    <ol className="mt-2 space-y-2.5">
                      {thread.citations.map((citation) => (
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
                <p className="mx-auto mt-2 max-w-lg text-sm font-bold leading-6 text-rose-key">{t('qaPendingHint')}</p>
              </section>
            ) : closed ? (
              <section role="status" className="rounded-3xl border border-rose-line bg-rose-card p-6 text-center shadow-sm">
                <h2 className="font-serif text-xl font-extrabold text-rose-ink">{t('qaClosedTitle')}</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm font-bold leading-6 text-rose-key">{t('qaClosedHint')}</p>
              </section>
            ) : null}
          </article>
        )}
      </main>
    </div>
  )
}
