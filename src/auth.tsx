import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState, useAuth } from './authState'
import { supabase } from './supabase'

function authRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

// Google은 앱 내 웹뷰(카카오톡·인스타그램 등 인앱 브라우저)에서의 OAuth 로그인을
// 차단한다(403 disallowed_useragent). 감지해서 기본 브라우저로 안내한다.
type InAppBrowser = 'kakaotalk' | 'etc' | null

function detectInAppBrowser(): InAppBrowser {
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk'
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|band\.us/i.test(ua)) return 'etc'
  return null
}

function openInExternalBrowser(kind: InAppBrowser) {
  const url = window.location.href
  if (kind === 'kakaotalk') {
    // 카카오톡 전용: 현재 페이지를 기기 기본 브라우저로 연다
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`
    return
  }
  if (/android/i.test(navigator.userAgent)) {
    window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;action=android.intent.action.VIEW;end`
  }
  // iOS의 기타 인앱 브라우저는 스킴이 없어 안내 문구로 대체된다
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
  const inAppBrowser = useMemo(() => detectInAppBrowser(), [])

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
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-rose-line border-t-rose-accent" />
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
      <div className="relative grid min-h-full place-items-center overflow-hidden bg-rose-bg px-5 py-10 text-rose-ink">
        {/* 배경 장식 — 은은한 클레이·샌드 빛망울 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 -top-28 h-80 w-80 rounded-full bg-rose-accent/[0.07] blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-rose-chip/70 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-[12%] top-[14%] h-24 w-24 rounded-full bg-rose-accent/[0.05] blur-xl"
        />

        <div className="w-full max-w-[24rem]" style={{ animation: 'fadeIn 0.5s ease both' }}>
          <div className="rounded-[28px] border border-rose-line bg-rose-card px-7 py-9 text-center shadow-[0_18px_50px_rgba(44,39,34,0.10)]">
            {/* 바인더 스택 일러스트 */}
            <div className="relative mx-auto mb-7 h-[148px] w-36">
              <div className="absolute left-0 top-4 h-[124px] w-[88px] -rotate-6 rounded-lg rounded-l-sm border border-rose-line bg-rose-chip/80 shadow-sm" />
              <div className="absolute right-0 top-3 h-[124px] w-[88px] rotate-[5deg] rounded-lg rounded-l-sm border border-rose-line bg-rose-bg shadow-sm" />
              <div className="absolute left-1/2 top-0 h-[148px] w-[108px] -translate-x-1/2 overflow-hidden rounded-xl rounded-l-md border border-rose-line bg-white shadow-[0_14px_30px_rgba(44,39,34,0.18)]">
                <span className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-rose-accent" />
                {/* 바인더 링 */}
                {[18, 42, 66, 84].map((top) => (
                  <span
                    key={top}
                    className="pointer-events-none absolute left-3 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-[1.5px] border-rose-accent/50 bg-white shadow-sm"
                    style={{ top: `${top}%` }}
                  />
                ))}
                <div className="flex h-full flex-col items-center justify-center pl-3">
                  <p className="text-[8px] font-black tracking-[0.3em] text-rose-key/70">EDA</p>
                  <p className="mt-1.5 font-serif text-[22px] font-extrabold leading-none">SPL</p>
                  <p className="mt-1 text-[11px] font-bold text-rose-key">바인더</p>
                  <span className="mt-2.5 h-px w-9 bg-rose-line" />
                  <p className="mt-2 text-[8px] font-black tracking-[0.24em] text-rose-accent/80">
                    EDA BOOKS
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">EDA BINDER</p>
            <h1 className="mt-2.5 font-serif text-[34px] font-extrabold leading-tight text-rose-ink">
              에다 SPL 바인더
            </h1>
            <p className="mx-auto mt-3 max-w-[19rem] text-[14px] font-bold leading-6.5 text-rose-key">
              Google 계정으로 로그인하면 필기와 책갈피가
              <br />내 바인더에 안전하게 저장됩니다.
            </p>

            {inAppBrowser ? (
              <div className="mt-7">
                <p className="rounded-xl border border-rose-accent/30 bg-rose-bg px-3.5 py-3 text-left text-[13px] font-bold leading-6 text-rose-ink">
                  {inAppBrowser === 'kakaotalk' ? '카카오톡' : '지금 사용 중인'} 앱 안의 브라우저에서는
                  Google이 보안 정책상 로그인을 차단해요.
                  <br />
                  <span className="text-rose-key">기본 브라우저(Chrome·Safari)로 열면 정상 로그인됩니다.</span>
                </p>
                <button
                  type="button"
                  onClick={() => openInExternalBrowser(inAppBrowser)}
                  className="mt-3 w-full rounded-full bg-rose-accent px-4 py-3.5 text-[15px] font-extrabold text-white shadow-sm shadow-rose-accent/30 transition active:scale-[0.99]"
                >
                  기본 브라우저로 열기
                </button>
                <p className="mt-3 text-xs font-bold leading-5 text-rose-key/70">
                  버튼이 동작하지 않으면 화면의 메뉴(⋮ 또는 공유)에서
                  <br />
                  ‘다른 브라우저로 열기’를 선택해 주세요.
                </p>
              </div>
            ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn}
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-full border border-rose-line bg-white px-4 py-3.5 text-[15px] font-extrabold text-rose-ink shadow-sm transition hover:-translate-y-0.5 hover:border-rose-accent/40 hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:opacity-70"
            >
              <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              <span>{signingIn ? 'Google로 이동 중...' : 'Google로 계속하기'}</span>
            </button>
            )}

            <p className="mt-4 text-xs font-bold leading-5 text-rose-key/60">
              로그인 후 내 계정에 바인더 기록이 동기화됩니다.
            </p>

            {(error || authError) && (
              <p className="mt-5 rounded-xl border border-rose-accent/30 bg-rose-bg px-3 py-2.5 text-sm font-bold leading-5 text-rose-accent">
                {error || authError}
              </p>
            )}
          </div>

          <blockquote className="mt-8 text-center font-serif text-[14px] leading-7 text-rose-key/85">
            “이 율법책을 네 입에서 떠나지 말게 하며
            <br />
            주야로 그것을 묵상하라”
            <footer className="mt-1.5 text-xs text-rose-key/60">— 여호수아 1:8</footer>
          </blockquote>
          <p className="mt-5 text-center font-mono text-[10px] text-rose-key/40">v{__BUILD__}</p>
        </div>
      </div>
    )
  }

  return children
}
