import { useCallback, useEffect, useRef, useState } from 'react'
import { addRecording, deleteRecording, listRecordings, type Recording } from '../db'
import { t } from '../i18n/strings'

interface Props {
  entryId: string
}

interface PlayableRecording {
  rec: Recording
  url: string
}

/** 사파리는 audio/webm을, 일부 안드로이드는 audio/mp4를 못 만든다 — 되는 쪽을 고르고 둘 다 안 되면 브라우저 기본값 */
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function VoiceRecorder({ entryId }: Props) {
  const [supported] = useState(isRecordingSupported)
  const [items, setItems] = useState<PlayableRecording[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const itemsRef = useRef<PlayableRecording[]>([])
  const mountedRef = useRef(true)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)

  const releaseItems = useCallback(() => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url))
    itemsRef.current = []
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const refresh = useCallback(async () => {
    const recs = await listRecordings(entryId)
    releaseItems()
    const next = recs.map((rec) => ({ rec, url: URL.createObjectURL(rec.blob) }))
    if (!mountedRef.current) {
      next.forEach((item) => URL.revokeObjectURL(item.url))
      return
    }
    itemsRef.current = next
    setItems(next)
  }, [entryId, releaseItems])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
      releaseItems()
    }
  }, [refresh, releaseItems])

  // 탭을 옮겨 이 영역이 사라져도 녹음 중이던 소리는 버리지 않고 onstop에서 저장까지 끝낸다
  useEffect(
    () => () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else stopStream()
    },
    [stopStream],
  )

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current)
    }, 250)
    return () => window.clearInterval(timer)
  }, [recording])

  const start = async () => {
    if (recording || !supported) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const preferred = pickMimeType()
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      startedAtRef.current = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current
        const mimeType = recorder.mimeType || preferred || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []
        recorderRef.current = null
        stopStream()
        setRecording(false)
        setElapsedMs(0)
        if (blob.size === 0) return
        void addRecording({
          id: crypto.randomUUID(),
          entryId,
          blob,
          mimeType,
          durationMs,
          createdAt: Date.now(),
        })
          .then(refresh)
          .catch(() => setError(t('recorderUnsupported')))
      }

      recorder.start()
      setElapsedMs(0)
      setRecording(true)
    } catch {
      stopStream()
      recorderRef.current = null
      setRecording(false)
      setError(t('recorderDenied'))
    }
  }

  const stop = () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      stopStream()
      setRecording(false)
      return
    }
    recorder.stop()
  }

  const remove = async (id: string) => {
    if (!window.confirm(t('recorderDeleteConfirm'))) return
    await deleteRecording(id)
    await refresh()
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="flex shrink-0 items-center gap-2 text-[13px] font-black tracking-[0.14em] text-rose-ink">
          <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-rose-accent" />
          {t('recorderTitle')}
        </h3>
        <span aria-hidden className="h-px min-w-6 flex-1 bg-rose-line" />
        {supported && (
          <button
            type="button"
            onClick={recording ? stop : start}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold transition active:scale-[0.98] ${
              recording
                ? 'bg-rose-accent-deep text-white shadow-sm shadow-rose-accent/25'
                : 'bg-rose-chip text-rose-accent'
            }`}
          >
            {recording ? `${t('recorderStop')} ${formatDuration(elapsedMs)}` : t('recorderStart')}
          </button>
        )}
      </div>

      {!supported ? (
        <p className="px-1 text-[11px] text-rose-key/70">{t('recorderUnsupported')}</p>
      ) : (
        <>
          {error && <p className="mb-2 px-1 text-xs text-red-500">{error}</p>}
          {items.length === 0 ? (
            <p className="px-1 text-[11px] text-rose-key/70">{t('recorderEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li
                  key={item.rec.id}
                  className="rounded-xl border border-rose-line bg-rose-card px-3 py-2 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-rose-ink">
                      {t('recorderItem')(index + 1)}
                      <span className="ml-2 text-xs font-medium text-rose-key">
                        {formatDuration(item.rec.durationMs)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(item.rec.id)}
                      className="shrink-0 text-sm text-rose-key/70 hover:text-rose-accent"
                    >
                      {t('recorderDelete')}
                    </button>
                  </div>
                  <audio controls src={item.url} className="mt-2 w-full" />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 px-1 text-[11px] text-rose-key/70">{t('recorderDeviceOnly')}</p>
        </>
      )}
    </div>
  )
}
