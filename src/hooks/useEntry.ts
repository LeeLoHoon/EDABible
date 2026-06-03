import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyTemptationVictory, type Entry } from '../types'
import { getEntry, putEntry } from '../db'

type SaveState = 'idle' | 'saving' | 'saved'

/**
 * 단일 묵상 엔트리를 로드하고, 변경 시 debounce 자동저장한다.
 * update(partial 또는 updater)로 부분 갱신.
 */
export function useEntry(id: string | undefined) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loading = id !== loadedId

  useEffect(() => {
    let alive = true
    if (!id) {
      Promise.resolve().then(() => {
        if (!alive) return
        setEntry(null)
        setLoadedId(undefined)
      })
      return
    }
    getEntry(id).then((e) => {
      if (!alive) return
      setEntry(e ? normalizeEntry(e) : null)
      setLoadedId(id)
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

function normalizeEntry(entry: Entry): Entry {
  return {
    ...entry,
    temptationVictory: entry.temptationVictory ?? emptyTemptationVictory(),
  }
}
