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
      <div className="grid min-h-full place-items-center bg-rose-bg px-5 py-8 text-rose-ink">
        <div className="w-full max-w-[27rem] text-center">
          <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-line bg-rose-card font-serif text-xl font-extrabold text-rose-accent shadow-sm">
            SPL
          </div>

          <p className="text-xs font-black tracking-[0.32em] text-rose-key">EDA BINDER</p>
          <h1 className="mt-4 font-serif text-4xl font-extrabold leading-tight text-rose-ink">
            에다 SPL 바인더
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm font-bold leading-7 text-rose-key">
            Google 계정으로 로그인하고 필기, 책갈피, 진행 상황을 안전하게 저장하세요.
          </p>

          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="mt-9 flex w-full items-center justify-center gap-3 rounded-xl border border-rose-line bg-rose-card px-4 py-3.5 text-base font-extrabold text-rose-ink shadow-sm transition hover:border-rose-accent hover:bg-white active:scale-[0.99] disabled:opacity-70"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-sans text-sm font-black text-[#4285f4] ring-1 ring-rose-line">
              G
            </span>
            <span>{signingIn ? 'Google로 이동 중...' : 'Google로 계속하기'}</span>
          </button>

          <p className="mt-4 text-xs font-bold leading-5 text-rose-key/75">
            로그인 후 내 계정에 바인더 기록이 동기화됩니다.
          </p>

          {(error || authError) && (
            <p className="mt-5 rounded-xl border border-rose-accent/30 bg-rose-card px-3 py-2 text-sm font-bold leading-5 text-rose-accent">
              {error || authError}
            </p>
          )}
        </div>
      </div>
    )
  }

  return children
}
