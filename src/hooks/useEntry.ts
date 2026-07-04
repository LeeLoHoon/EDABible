import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_QUESTION_SET_ID, emptyTemptationVictory, type Entry } from '../types'
import { getEntry, putEntry } from '../db'
import { registerSaveFlush } from '../saveFlush'

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
  // 아직 putEntry로 확정되지 않은 최신 엔트리 — 디바운스 중 리로드/이탈이
  // 일어나도 flush로 저장할 수 있게 붙잡아 둔다
  const pendingRef = useRef<Entry | null>(null)
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

  // 대기 중인 변경을 즉시 저장. 실패하면 pending을 유지해 다음 flush에서 재시도.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const pending = pendingRef.current
    if (!pending) return
    try {
      await putEntry(pending)
      if (pendingRef.current === pending) pendingRef.current = null
      setSaveState('saved')
    } catch {
      setSaveState('idle')
    }
  }, [])

  // SW 업데이트 리로드(main.tsx)·탭 전환·앱 종료·언마운트 시 대기 중인 저장 flush
  useEffect(() => {
    const onPageHide = () => {
      void flush()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const unregister = registerSaveFlush(flush)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unregister()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void flush()
    }
  }, [flush])

  const update = useCallback(
    (patch: Partial<Entry> | ((e: Entry) => Entry)) => {
      setEntry((prev) => {
        if (!prev) return prev
        const next =
          typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
        next.updatedAt = Date.now()
        // debounce 저장 — 연속 입력 중에는 미뤄지므로 pending으로도 붙잡아 둔다
        pendingRef.current = next
        setSaveState('saving')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          void flush()
        }, 600)
        return next
      })
    },
    [flush],
  )

  return { entry, loading, saveState, update }
}

function normalizeEntry(entry: Entry): Entry {
  const temptationVictory = {
    ...emptyTemptationVictory(),
    ...(entry.temptationVictory ?? {}),
  }

  return {
    ...entry,
    questionSet: entry.questionSet ?? DEFAULT_QUESTION_SET_ID,
    temptationVictory,
    // 로드 시 한 번만 backfill — 렌더마다 새 배열을 만들면 PassageText memo가 깨진다
    highlightedVerses: entry.highlightedVerses ?? [],
  }
}
