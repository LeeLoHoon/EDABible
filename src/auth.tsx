import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState, useAuth } from './authState'
import { supabase } from './supabase'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(!!supabase)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      async signInWithGoogle() {
        if (!supabase) return
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.href,
          },
        })
        if (error) throw error
      },
      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }),
    [loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function RequireGoogleLogin({ children }: { children: React.ReactNode }) {
  const { loading, user, signInWithGoogle } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const handleSignIn = async () => {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '로그인에 실패했습니다.')
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center bg-rose-bg px-6 text-rose-ink">
        <p className="font-serif text-lg font-extrabold">로그인 확인 중...</p>
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
      <div className="grid min-h-full place-items-center bg-rose-bg px-6 text-center text-rose-ink">
        <div className="w-full max-w-sm rounded-2xl border border-rose-line bg-rose-card p-6 shadow-sm">
          <p className="text-xs font-bold tracking-[0.28em] text-rose-key">EDA</p>
          <h1 className="mt-3 font-serif text-3xl font-extrabold">SPL 바인더</h1>
          <button
            type="button"
            onClick={handleSignIn}
            className="mt-7 w-full rounded-xl bg-rose-accent px-4 py-3 text-base font-extrabold text-white shadow-lg shadow-rose-accent/25 active:scale-[0.99]"
          >
            Google로 로그인
          </button>
          {error && <p className="mt-4 text-sm font-bold text-rose-accent">{error}</p>}
        </div>
      </div>
    )
  }

  return children
}
