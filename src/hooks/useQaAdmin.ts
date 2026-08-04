import { useEffect, useState } from 'react'
import { useAuth } from '../authState'
import { isQaAdmin } from '../qa'

// Q&A는 아직 공개 전이라 관리자에게만 진입점을 노출한다.
// 판정은 사용자별로 세션 동안 공유해, 화면을 옮기거나 여러 컴포넌트가 물어봐도 조회는 한 번이다.
const adminChecks = new Map<string, Promise<boolean>>()

function checkQaAdmin(userId: string): Promise<boolean> {
  const inFlight = adminChecks.get(userId)
  if (inFlight) return inFlight

  const pending = isQaAdmin().catch((error) => {
    if (import.meta.env.DEV) console.warn('Q&A admin check failed.', error instanceof Error)
    // 일시적 오류까지 세션 내내 붙잡아두지 않는다 — 다음 진입에서 다시 물어본다.
    adminChecks.delete(userId)
    return false
  })
  adminChecks.set(userId, pending)
  return pending
}

export interface QaAdminState {
  /** 판정이 끝나기 전에는 진입점을 감춘 채 기다린다 (깜빡임 방지). */
  checking: boolean
  isAdmin: boolean
}

export function useQaAdmin(): QaAdminState {
  const { loading: authLoading, user } = useAuth()
  const userId = user?.id
  const [checked, setChecked] = useState<{ userId: string; allowed: boolean } | null>(null)

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    void checkQaAdmin(userId).then((allowed) => {
      // 세션이 바뀐 뒤 도착한 응답은 버린다.
      if (cancelled) return
      setChecked({ userId, allowed })
    })

    return () => {
      cancelled = true
    }
  }, [userId])

  if (authLoading) return { checking: true, isAdmin: false }
  if (!userId) return { checking: false, isAdmin: false }
  if (checked?.userId !== userId) return { checking: true, isAdmin: false }
  return { checking: false, isAdmin: checked.allowed }
}
