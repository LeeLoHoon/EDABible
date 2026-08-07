import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_QUESTION_SET_ID, emptyTemptationVictory, type Entry } from '../types'
import {
  commitEntrySnapshot,
  ENTRY_LOCAL_OWNER,
  getEntry,
  hasEntryConflict,
  pushEntry,
  resolveEntryConflictKeepLocal,
  resolveEntryConflictUseRemote,
} from '../db'
import { registerSaveFlush } from '../saveFlush'
import { applyRanges } from '../highlights'
import { drainPendingRef } from '../persistenceQueue'
import { shouldClearEntryJournalAfterCommit } from '../entryCommit'
import {
  retryEntryOperation,
  runEntryTransition,
  selectForeignEntryRecoveries,
  selectLatestEntryRecovery,
  selectUpdateBase,
} from '../entryTransition'
import {
  clearEntryJournal,
  readEntryJournals,
  shouldRecoverEntryJournal,
  writeEntryJournal,
} from '../entryJournal'

export type EntrySaveState = 'idle' | 'saving' | 'saved'
export type EntryHookError =
  | 'journal-unavailable'
  | 'save-failed'
  | 'transition-blocked'
  | 'load-failed'

type RetrySource = 'journal' | 'save' | 'transition' | 'load'
type EntryOwnerRef = { current: Entry | null }

/** 원격 업로드는 로컬 저장보다 느긋하게 — 획 하나마다 본문 전체를 올리지 않기 위해서다 */
const REMOTE_PUSH_IDLE_MS = 3000

/**
 * 단일 묵상 엔트리를 로드하고, 변경 시 debounce 자동저장한다.
 * update(partial 또는 updater)로 부분 갱신.
 *
 * 저장은 두 단계다 — 로컬(IndexedDB)에 먼저 확정하고(오프라인에서도 글이 남는다),
 * 계정 소유일 때만 그보다 느긋한 간격으로 원격에 올린다.
 */
export function useEntry(id: string | undefined, ownerId: string) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loadedId, setLoadedId] = useState<string | undefined | null>(undefined)
  const [saveState, setSaveState] = useState<EntrySaveState>('idle')
  const [error, setError] = useState<EntryHookError | null>(null)
  const [editingBlocked, setEditingBlocked] = useState(false)
  const [navigationBlocked, setNavigationBlocked] = useState(false)
  const [conflict, setConflict] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entryRef = useRef<Entry | null>(null)
  // 아직 저장으로 확정되지 않은 최신 엔트리 — 디바운스 중 리로드/이탈이
  // 일어나도 flush로 저장할 수 있게 붙잡아 둔다
  const pendingRef = useRef<Entry | null>(null)
  // journal 기록에 실패한 값은 durable commit 전까지 UI에 노출하지 않는다.
  const fallbackCandidateRef = useRef<Entry | null>(null)
  const flushPromiseRef = useRef<Promise<void> | null>(null)
  const idRef = useRef<string | undefined>(undefined)
  const loadedIdRef = useRef<string | undefined>(undefined)
  const errorRef = useRef<EntryHookError | null>(null)
  const editingBlockedRef = useRef(false)
  const retrySourceRef = useRef<RetrySource | null>(null)
  // 원격 업로드 대기 — 로컬 저장과 별도 타이머로 돌린다
  const remoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remotePendingRef = useRef<Entry | null>(null)
  const [transitionTick, setTransitionTick] = useState(0)
  const loading = id !== loadedId && error === null

  const setBlocking = useCallback((editing: boolean, navigation: boolean) => {
    editingBlockedRef.current = editing
    setEditingBlocked(editing)
    setNavigationBlocked(navigation)
  }, [])

  const clearFailure = useCallback(() => {
    errorRef.current = null
    retrySourceRef.current = null
    setError(null)
    setBlocking(false, false)
  }, [setBlocking])

  const fail = useCallback(
    (nextError: EntryHookError, source: RetrySource) => {
      errorRef.current = nextError
      retrySourceRef.current = source
      setError(nextError)
      setBlocking(true, true)
    },
    [setBlocking],
  )

  const syncsRemotely = !!ownerId && ownerId !== ENTRY_LOCAL_OWNER

  /** 대기 중인 원격 업로드를 즉시 실행. 실패해도 dirty가 남아 다음 기회에 다시 올라간다. */
  const pushRemote = useCallback(async (): Promise<void> => {
    if (remoteTimer.current) {
      clearTimeout(remoteTimer.current)
      remoteTimer.current = null
    }
    const target = remotePendingRef.current
    remotePendingRef.current = null
    if (!target || !syncsRemotely) return
    try {
      await pushEntry(target.id, ownerId)
    } catch (pushError) {
      console.warn('Meditation entry upload failed; it stays queued.', pushError)
    }
    try {
      setConflict(await hasEntryConflict(target.id, ownerId))
    } catch {
      // 충돌 표시를 못 읽어도 편집은 계속할 수 있어야 한다
    }
  }, [ownerId, syncsRemotely])

  const scheduleRemotePush = useCallback(
    (snapshot: Entry) => {
      if (!syncsRemotely) return
      remotePendingRef.current = snapshot
      if (remoteTimer.current) clearTimeout(remoteTimer.current)
      remoteTimer.current = setTimeout(() => {
        remoteTimer.current = null
        void pushRemote()
      }, REMOTE_PUSH_IDLE_MS)
    },
    [pushRemote, syncsRemotely],
  )

  const commitEntry = useCallback(async (snapshot: Entry, ownerRef: EntryOwnerRef) => {
    const result = await commitEntrySnapshot(snapshot, ownerId)
    scheduleRemotePush(snapshot)
    const shouldReadDurable =
      result.status === 'superseded' &&
      ownerRef.current === snapshot &&
      idRef.current === snapshot.id &&
      loadedIdRef.current === snapshot.id

    let durable: Entry | undefined
    if (shouldReadDurable) {
      durable = await getEntry(snapshot.id, ownerId)
    }

    const ownsSnapshot = ownerRef.current === snapshot
    const canExpose =
      ownsSnapshot &&
      idRef.current === snapshot.id &&
      loadedIdRef.current === snapshot.id
    if (!ownsSnapshot) return

    if (shouldClearEntryJournalAfterCommit(snapshot, ownerRef.current)) {
      clearEntryJournal(snapshot.id, result.durableUpdatedAt)
    }

    if (fallbackCandidateRef.current === snapshot) {
      fallbackCandidateRef.current = null
    }
    if (!canExpose) return

    if (result.status === 'superseded') {
      const next = durable ? normalizeEntry(durable) : null
      entryRef.current = next
      setEntry(next)
      return
    }
    if (entryRef.current !== snapshot) {
      const next = normalizeEntry(snapshot)
      entryRef.current = next
      setEntry(next)
    }
  }, [ownerId, scheduleRemotePush])

  // 대기 중인 변경을 즉시 저장. 실패하면 pending을 유지해 다음 flush에서 재시도.
  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (flushPromiseRef.current) return flushPromiseRef.current

    const task = retryEntryOperation(() =>
      drainPendingRef(pendingRef, (snapshot) => commitEntry(snapshot, pendingRef)),
    )
      .then(() => {
        setSaveState('saved')
        if (retrySourceRef.current === 'save') clearFailure()
      })
      .catch((flushError: unknown) => {
        setSaveState('idle')
        fail('save-failed', 'save')
        throw flushError
      })
      .finally(() => {
        if (flushPromiseRef.current === task) flushPromiseRef.current = null
      })
    flushPromiseRef.current = task
    return task
  }, [clearFailure, commitEntry, fail])

  useEffect(() => {
    idRef.current = id
    let alive = true

    const clearExposedEntry = () => {
      entryRef.current = null
      loadedIdRef.current = undefined
      setEntry(null)
      setLoadedId(null)
    }

    const run = async () => {
      errorRef.current = null
      setError(null)

      if (loadedIdRef.current !== undefined && loadedIdRef.current !== id) {
        clearExposedEntry()
      }

      const journalRead = readEntryJournals()
      if (journalRead.status === 'unavailable') {
        if (loadedIdRef.current !== id) clearExposedEntry()
        fail('journal-unavailable', 'journal')
        return
      }

      const foreignRecoveries = selectForeignEntryRecoveries(
        id,
        pendingRef.current,
        journalRead.entries,
      )
      if (foreignRecoveries.length > 0) {
        setBlocking(true, true)
        clearExposedEntry()
      }
      for (const recovery of foreignRecoveries) {
        if (!alive || idRef.current !== id) return
        if (pendingRef.current?.id === recovery.id) {
          pendingRef.current = recovery
          setSaveState('saving')
          try {
            await flush()
          } catch {
            if (alive && idRef.current === id) fail('transition-blocked', 'transition')
            return
          }
          continue
        }

        const foreignRef: EntryOwnerRef = { current: recovery }
        try {
          await retryEntryOperation(() =>
            drainPendingRef(foreignRef, (snapshot) => commitEntry(snapshot, foreignRef)),
          )
        } catch {
          if (alive && idRef.current === id) fail('transition-blocked', 'transition')
          return
        }
      }

      if (!alive || idRef.current !== id) return

      const fallback = fallbackCandidateRef.current
      if (fallback && fallback.id === id && pendingRef.current === fallback) {
        setBlocking(true, true)
        setSaveState('saving')
        try {
          await flush()
        } catch {
          return
        }
      }

      if (!alive || idRef.current !== id) return

      let recoveredSaveFailed = false
      const result = await runEntryTransition(id, loadedIdRef.current, {
        getPendingId: () => pendingRef.current?.id,
        flushPending: () => flush(),
        clearExposedEntry,
        loadEntry: async (targetId) => {
          const stored = await retryEntryOperation(() => getEntry(targetId, ownerId))
          if (!alive || idRef.current !== targetId) return

          const matchingPending =
            pendingRef.current?.id === targetId &&
            pendingRef.current !== fallbackCandidateRef.current
              ? pendingRef.current
              : undefined
          const matchingJournal = journalRead.entries.find(
            (candidate) => candidate.id === targetId,
          )
          const recoveredJournal =
            matchingJournal && shouldRecoverEntryJournal(matchingJournal, stored)
              ? normalizeEntry(matchingJournal)
              : undefined
          if (matchingJournal && !recoveredJournal && stored) {
            clearEntryJournal(targetId, stored.updatedAt)
          }
          const recovered = selectLatestEntryRecovery(matchingPending, recoveredJournal)
          const next = recovered ?? (stored ? normalizeEntry(stored) : null)
          entryRef.current = next
          setEntry(next)
          loadedIdRef.current = targetId
          setLoadedId(targetId)
          try {
            setConflict(await hasEntryConflict(targetId, ownerId))
          } catch {
            // 충돌 표시를 못 읽어도 묵상은 열려야 한다
          }
          if (!recovered) return

          pendingRef.current = recovered
          setSaveState('saving')
          setBlocking(true, true)
          try {
            await flush()
          } catch {
            recoveredSaveFailed = true
          }
        },
        isCurrent: (targetId) => alive && idRef.current === targetId,
      })

      if (!alive || idRef.current !== id) return
      if (result === 'blocked') {
        fail('transition-blocked', 'transition')
        return
      }
      if (result === 'cleared') {
        loadedIdRef.current = undefined
        setLoadedId(undefined)
      }
      if (recoveredSaveFailed || errorRef.current !== null) return
      if (result === 'loaded' || result === 'cleared' || result === 'aborted') {
        clearFailure()
      }
    }

    void run().catch(() => {
      if (alive && idRef.current === id) fail('load-failed', 'load')
    })
    return () => {
      alive = false
    }
  }, [clearFailure, commitEntry, fail, flush, id, ownerId, setBlocking, transitionTick])

  // SW 업데이트 리로드(main.tsx)·탭 전환·앱 종료·언마운트 시 대기 중인 저장 flush
  useEffect(() => {
    // 이탈 시엔 원격 업로드도 앞당겨 다른 기기에서 곧바로 이어 볼 수 있게 한다.
    // 실패해도 dirty가 남아 다음 진입 때 flushDirtyEntries가 올린다.
    const flushAll = () => {
      void flush()
        .catch(() => undefined)
        .then(() => pushRemote())
        .catch(() => undefined)
    }
    const onPageHide = () => {
      flushAll()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAll()
    }
    // 업데이트 리로드는 로컬 저장만 기다린다 — 네트워크 왕복까지 붙들면 리로드가 늦어진다.
    const unregister = registerSaveFlush(flush)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unregister()
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      flushAll()
    }
  }, [flush, pushRemote])

  useEffect(() => {
    if (!navigationBlocked) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [navigationBlocked])

  const retry = useCallback(async (): Promise<void> => {
    const source = retrySourceRef.current
    errorRef.current = null
    setError(null)
    if (source === 'save' && pendingRef.current) {
      setSaveState('saving')
      try {
        await flush()
      } catch {
        return
      }
      return
    }
    setTransitionTick((value) => value + 1)
  }, [flush])

  const update = useCallback(
    (patch: Partial<Entry> | ((e: Entry) => Entry)) => {
      if (editingBlockedRef.current) return
      const previous = selectUpdateBase(
        idRef.current,
        loadedIdRef.current,
        pendingRef.current,
        entryRef.current,
      )
      if (!previous) return
      const updated =
        typeof patch === 'function' ? patch(previous) : { ...previous, ...patch }
      const next = {
        ...updated,
        updatedAt: Math.max(Date.now(), previous.updatedAt + 1),
      }
      // sessionStorage journal is synchronous so a hard reload can recover before debounce/IndexedDB.
      const journalWrite = writeEntryJournal(next)
      pendingRef.current = next
      setSaveState('saving')
      if (journalWrite.status === 'failed') {
        fallbackCandidateRef.current = next
        fail('journal-unavailable', 'save')
        void flush().catch(() => undefined)
        return
      }

      entryRef.current = next
      setEntry(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void flush().catch(() => undefined)
      }, 600)
    },
    [fail, flush],
  )

  /** 충돌 배너 — 내 기기 내용을 원격 위에 덮어쓴다 */
  const keepMineOnConflict = useCallback(async (): Promise<void> => {
    if (!id || !syncsRemotely) return
    // 대기 중인 편집까지 로컬에 확정한 뒤 올려야 방금 쓴 내용이 빠지지 않는다
    await flush().catch(() => undefined)
    await resolveEntryConflictKeepLocal(id, ownerId)
    setConflict(false)
  }, [flush, id, ownerId, syncsRemotely])

  /** 충돌 배너 — 이 기기의 편집을 버리고 원격본을 다시 불러온다 */
  const useRemoteOnConflict = useCallback(async (): Promise<void> => {
    if (!id || !syncsRemotely) return
    await resolveEntryConflictUseRemote(id, ownerId)
    if (remoteTimer.current) {
      clearTimeout(remoteTimer.current)
      remoteTimer.current = null
    }
    remotePendingRef.current = null
    pendingRef.current = null
    fallbackCandidateRef.current = null
    entryRef.current = null
    loadedIdRef.current = undefined
    setLoadedId(undefined)
    setConflict(false)
    setTransitionTick((value) => value + 1)
  }, [id, ownerId, syncsRemotely])

  return {
    entry,
    loading,
    saveState,
    error,
    editingBlocked,
    navigationBlocked,
    conflict,
    retry,
    update,
    keepMineOnConflict,
    useRemoteOnConflict,
  }
}

function normalizeEntry(entry: Entry): Entry {
  const temptationVictory = {
    ...emptyTemptationVictory(),
    ...(entry.temptationVictory ?? {}),
  }

  // 구 "구절 전체 탭 토글" 데이터는 gold 전체 range로 마이그레이션한다.
  // end는 MAX_SAFE_INTEGER — 렌더의 orphan clamp가 구절 길이에 맞춰 자른다.
  // legacy를 base로 두고 기존 부분 range를 위에 적용해 이전 시각 결과를 보존.
  const ranges = entry.highlightRanges ?? []
  const legacy = (entry.highlightedVerses ?? []).map((key) => ({
    key,
    start: 0,
    end: Number.MAX_SAFE_INTEGER,
    color: 'gold' as const,
  }))

  return {
    ...entry,
    questionSet: entry.questionSet ?? DEFAULT_QUESTION_SET_ID,
    temptationVictory,
    // 로드 시 한 번만 계산 — 렌더마다 새 배열을 만들면 PassageText memo가 깨진다
    highlightedVerses: [],
    highlightRanges: legacy.length ? applyRanges(legacy, ranges) : ranges,
  }
}
