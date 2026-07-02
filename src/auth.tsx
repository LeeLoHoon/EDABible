import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState, useAuth } from './authState'
import { supabase } from './supabase'

function authRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(!!supabase)
  const [authError, setAuthError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabase) return

    const loadingTimer = window.setTimeout(() => {
      setLoading(false)
      setAuthError('로그인 확인이 지연되고 있습니다. 다시 시도해 주세요.')
    }, 8000)

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setAuthError(error.message)
        setSession(data.session)
      })
      .catch((error) => {
        setAuthError(error instanceof Error ? error.message : '로그인 상태를 확인하지 못했습니다.')
      })
      .finally(() => {
        window.clearTimeout(loadingTimer)
        setLoading(false)
      })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAuthError(null)
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      window.clearTimeout(loadingTimer)
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      authError,
      session,
      user: session?.user ?? null,
      async signInWithGoogle() {
        if (!supabase) return
        setAuthError(null)
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: authRedirectUrl(),
          },
        })
        if (error) throw error
      },
      async signOut() {
        if (!supabase) return
        setAuthError(null)
        setSession(null)
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        if (error) setAuthError(error.message)
      },
    }),
    [authError, loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function RequireGoogleLogin({ children }: { children: React.ReactNode }) {
  const { authError, loading, user, signInWithGoogle } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  const handleSignIn = async () => {
    setError(null)
    setSigningIn(true)
    try {
      await signInWithGoogle()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '로그인에 실패했습니다.')
      setSigningIn(false)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center bg-rose-bg px-6 text-rose-ink">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 rounded-full border-4 border-rose-line border-t-rose-accent" />
          <p className="mt-4 font-serif text-lg font-extrabold">로그인 확인 중...</p>
        </div>
      </div>
    )
  }

  if (!supabase) {
    return (
      <div className="grid min-h-full place-items-center bg-rose-bg px-6 text-center text-rose-ink">
        <div className="max-w-sm rounded-2xl border border-rose-line bg-rose-card p-6 shadow-sm">
          <h1 className="font-serif text-2xl font-extrabold">에다 SPL 바인더</h1>
          <p className="mt-4 text-sm leading-6 text-rose-key">
            Supabase 환경변수가 없어 로그인할 수 없습니다.
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-full bg-rose-bg px-5 py-6 text-rose-ink sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
          <div className="grid w-full items-center gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="relative min-h-[30rem] overflow-hidden rounded-[28px] border border-rose-line bg-rose-card shadow-[0_22px_70px_rgba(44,39,34,0.16)]">
              <div className="absolute inset-y-0 left-0 w-8 bg-rose-accent" />
              <div className="absolute inset-y-0 left-12 border-l border-dashed border-rose-line" />
              <div className="absolute inset-5 rounded-[22px] border border-rose-line/70" />
              <div className="absolute inset-x-10 top-10 flex items-center gap-3 text-rose-key">
                <span className="h-px flex-1 bg-rose-line" />
                <span className="text-xs font-black tracking-[0.36em]">EDA</span>
                <span className="h-px flex-1 bg-rose-line" />
              </div>
              <div className="relative flex min-h-[30rem] flex-col justify-center px-12 py-14 pl-16 text-center">
                <p className="text-xs font-black tracking-[0.34em] text-rose-key">PERSONAL LIBRARY</p>
                <h1 className="mt-7 font-serif text-[3.4rem] font-extrabold leading-none text-rose-ink sm:text-[4.4rem]">
                  SPL
                </h1>
                <p className="mt-3 font-serif text-3xl font-extrabold">바인더</p>
                <div className="mx-auto my-8 flex w-40 items-center gap-3 text-rose-accent/75">
                  <span className="h-px flex-1 bg-rose-line" />
                  <span className="text-lg">✦</span>
                  <span className="h-px flex-1 bg-rose-line" />
                </div>
                <p className="mx-auto max-w-xs text-sm font-bold leading-7 text-rose-key">
                  필기와 책갈피를 계정에 저장합니다.
                  <br />
                  Google 계정으로 계속하세요.
                </p>
              </div>
            </section>

            <aside className="rounded-[24px] border border-rose-line bg-rose-card p-5 shadow-sm md:p-6">
              <p className="text-xs font-black tracking-[0.28em] text-rose-key">SIGN IN</p>
              <h2 className="mt-3 font-serif text-2xl font-extrabold">에다 SPL 바인더</h2>
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-rose-chip px-3 py-2 text-sm font-bold text-rose-key">
                  <span>동기화</span>
                  <span className="text-rose-accent">Google</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-rose-chip px-3 py-2 text-sm font-bold text-rose-key">
                  <span>저장 위치</span>
                  <span className="text-rose-accent">내 계정</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-base font-extrabold text-rose-ink shadow-sm ring-1 ring-rose-line transition hover:ring-rose-accent active:scale-[0.99] disabled:opacity-70"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full border border-rose-line font-sans text-sm font-black text-[#4285f4]">
                  G
                </span>
                {signingIn ? '이동 중...' : 'Google로 로그인'}
              </button>
              {(error || authError) && (
                <p className="mt-4 rounded-xl border border-rose-accent/30 bg-rose-chip px-3 py-2 text-sm font-bold leading-5 text-rose-accent">
                  {error || authError}
                </p>
              )}
            </aside>
          </div>
        </div>
      </div>
    )
  }

  return children
}
