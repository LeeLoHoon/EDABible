import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry } from '../types'
import { getEntry, putEntry } from '../db'

type SaveState = 'idle' | 'saving' | 'saved'

/**
 * 단일 묵상 엔트리를 로드하고, 변경 시 debounce 자동저장한다.
 * update(partial 또는 updater)로 부분 갱신.
 */
export function useEntry(id: string | undefined) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    if (!id) {
      setEntry(null)
      setLoading(false)
      return
    }
    getEntry(id).then((e) => {
      if (!alive) return
      setEntry(e ?? null)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [id])

  // 언마운트 시 대기 중인 저장 flush
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const update = useCallback((patch: Partial<Entry> | ((e: Entry) => Entry)) => {
    setEntry((prev) => {
      if (!prev) return prev
      const next =
        typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      next.updatedAt = Date.now()
      // debounce 저장
      setSaveState('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        putEntry(next)
          .then(() => setSaveState('saved'))
          .catch(() => setSaveState('idle'))
      }, 600)
      return next
    })
  }, [])

  return { entry, loading, saveState, update }
}
