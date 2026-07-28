import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../authState'
import LangToggle from '../components/LangToggle'
import SermonAdminForm from '../components/SermonAdminForm'
import {
  db,
  isSermonAdmin,
  listSermons,
  SERMON_LOCAL_USER,
  type Sermon,
  type SermonService,
} from '../db'
import { sermonPassagesLabel } from '../sermon'
import { pickCurrentPreachedOn } from '../sermonWeek'
import { isFieldEmpty } from '../types'
import { formatEntryDateDot } from '../i18n/format'
import { t } from '../i18n/strings'

const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_WINDOW_MS = 2_000

interface NoteMeta {
  updatedAt: number
  hasContent: boolean
}

function daysSince(now: number, then: number): number {
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)))
}

function serviceLabel(service: SermonService): string {
  return service === 'morning' ? t('sermonServiceMorning') : t('sermonServiceAfternoon')
}

export default function SermonPage() {
  const navigate = useNavigate()
  const { user, signInWithGoogle, signOut } = useAuth()
  // 토큰 갱신으로 user 참조가 바뀌어도 id 문자열이 같으면 재로드하지 않는다 (BinderPage와 동일 패턴)
  const userId = user?.id
  const [sermons, setSermons] = useState<Sermon[]>([])
  const [loading, setLoading] = useState(true)
  const [noteMeta, setNoteMeta] = useState<Record<string, NoteMeta>>({})
  // "N일 전" 인디케이터는 세션 내내 안정적이면 충분해 마운트 시점 하나로 고정한다.
  // 렌더 중 Date.now()를 부르지 않아야 react-hooks/purity를 지킨다.
  const [now] = useState(() => Date.now())
  const [adminModeUserId, setAdminModeUserId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingSermon, setEditingSermon] = useState<Sermon | null>(null)
  const adminTapRef = useRef({ count: 0, deadline: 0 })
  const adminMode = adminModeUserId !== null && adminModeUserId === userId

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listSermons()
      setSermons(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  useEffect(() => {
    // 마지막 기록 인디케이터는 로컬 캐시만으로 만든다 — 목록당 N번의 Supabase 왕복을 피하면서
    // 이미 열어본 설교의 흔적만 조용히 보여준다. 첫 방문 때는 인디케이터 없음(nagging 방지).
    let alive = true
    // key는 `${소유자}:${sermonId}` — userId는 Dexie 인덱스가 아니라서 primary key로 훑는다
    db.sermonNotes
      .where('key')
      .startsWith(`${userId ?? SERMON_LOCAL_USER}:`)
      .toArray()
      .then((notes) => {
        if (!alive) return
        const meta: Record<string, NoteMeta> = {}
        for (const note of notes) {
          const hasContent =
            !isFieldEmpty(note.freeNote) ||
            note.pointAnswers.some((answer) => !isFieldEmpty(answer)) ||
            note.highlightRanges.length > 0
          meta[note.sermonId] = { updatedAt: note.updatedAt, hasContent }
        }
        setNoteMeta(meta)
      })
      .catch((error) => {
        console.warn('Sermon note metadata load failed.', error)
      })
    return () => {
      alive = false
    }
  }, [userId, sermons])

  // 관리자 RLS가 미게시 설교를 내려줄 수 있으므로 화면에서 한 번 더 거른다 — 보안 요건
  const visibleSermons = adminMode ? sermons : sermons.filter((sermon) => sermon.published)

  const groups = new Map<string, Sermon[]>()
  for (const sermon of visibleSermons) {
    const list = groups.get(sermon.preachedOn) ?? []
    list.push(sermon)
    groups.set(sermon.preachedOn, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.service.localeCompare(b.service))
  }

  const uniqueDates = [...groups.keys()].sort().reverse()
  const currentDate = pickCurrentPreachedOn(uniqueDates, new Date())
  const currentGroup = currentDate ? groups.get(currentDate) ?? [] : []
  const pastDates = uniqueDates.filter((date) => date !== currentDate)

  const handleAdminTap = () => {
    const tapTime = performance.now()
    const taps = adminTapRef.current
    if (tapTime > taps.deadline) {
      taps.count = 1
      taps.deadline = tapTime + ADMIN_TAP_WINDOW_MS
      return
    }
    taps.count += 1
    if (taps.count < ADMIN_TAP_COUNT) return
    taps.count = 0
    taps.deadline = 0
    if (!userId) return

    // 관리자가 아니면 아무 신호도 보내지 않는다 — 기능의 존재 자체를 노출하지 않는다
    void isSermonAdmin(userId).then((allowed) => {
      if (!allowed) return
      setAdminModeUserId(adminMode ? null : userId)
      navigator.vibrate?.(40)
    })
  }

  const openNewForm = () => {
    setEditingSermon(null)
    setFormOpen(true)
  }
  const openEditForm = (sermon: Sermon) => {
    setEditingSermon(sermon)
    setFormOpen(true)
  }
  const closeForm = () => setFormOpen(false)
  const handleFormSaved = () => {
    setFormOpen(false)
    void reload()
  }

  const renderCard = (sermon: Sermon) => {
    const meta = noteMeta[sermon.id]
    const showLastWritten = meta?.hasContent === true
    const daysAgo = showLastWritten ? daysSince(now, meta.updatedAt) : null

    return (
      <article
        key={sermon.id}
        className={`rounded-2xl border bg-rose-card p-4 shadow-sm ${
          adminMode && !sermon.published
            ? 'border-rose-accent-deep/40 bg-rose-card/80'
            : 'border-rose-line'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="rounded-full bg-rose-chip px-2 py-0.5 text-xs font-black text-rose-accent">
            {serviceLabel(sermon.service)}
          </span>
          {sermon.preacher && (
            <span className="text-sm font-bold text-rose-key">· {sermon.preacher}</span>
          )}
          {adminMode && !sermon.published && (
            <span className="rounded-full bg-rose-accent-deep px-2 py-0.5 text-[11px] font-black text-white">
              {t('sermonUnpublishedBadge')}
            </span>
          )}
        </div>
        <h3 className="mt-1.5 font-serif text-lg font-extrabold text-rose-ink">{sermon.title}</h3>
        {sermon.passages.length > 0 && (
          <p className="mt-1 text-sm font-medium text-rose-key">
            {sermonPassagesLabel(sermon.passages)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate(`/sermon/${sermon.id}`)}
            className="rounded-full bg-rose-accent-deep px-4 py-2 text-sm font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98]"
          >
            {daysAgo !== null ? t('sermonOpenNote') : t('sermonStartNote')}
          </button>
          {daysAgo !== null && (
            <span className="text-xs font-medium text-rose-key/80">
              {t('sermonLastWritten')(daysAgo)}
            </span>
          )}
          {adminMode && (
            <button
              type="button"
              onClick={() => openEditForm(sermon)}
              className="rounded-full border border-rose-line bg-white px-2.5 py-1.5 text-xs font-bold text-rose-key transition hover:border-rose-accent-deep hover:text-rose-accent-deep"
            >
              {t('sermonAdminEdit')}
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="min-h-full bg-rose-bg text-rose-ink">
      <header className="sticky top-0 z-20 border-b border-rose-line bg-rose-bg/95 px-4 py-2.5 backdrop-blur">
        {adminMode && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-rose-accent-deep"
          />
        )}
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex w-24 shrink-0 items-center">
            {__APP_TARGET__ === 'all' ? (
              <Link to="/" className="flex flex-col leading-tight" aria-label={t('sermonGoHome')}>
                <span className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">
                  ← EDA
                </span>
                <span className="font-mono text-[9px] text-rose-key/45">v{__BUILD__}</span>
              </Link>
            ) : (
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-black tracking-[0.3em] text-rose-key/70">EDA</span>
                <span className="font-mono text-[9px] text-rose-key/45">v{__BUILD__}</span>
              </span>
            )}
          </div>
          <h1
            onClick={handleAdminTap}
            className="min-w-0 flex-1 truncate text-center font-serif text-lg font-extrabold"
          >
            {t('sermonAppTitle')}
          </h1>
          <div className="flex shrink-0 items-center justify-end gap-1">
            {adminMode && (
              <button
                type="button"
                onClick={() => setAdminModeUserId(null)}
                className="flex shrink-0 items-center gap-1 rounded-full bg-rose-accent-deep px-2.5 py-1.5 text-[12px] font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-95 sm:px-3 sm:text-[13px]"
                aria-label={t('sermonExitAdmin')}
              >
                <span aria-hidden>🛡</span>
                <span className="hidden sm:inline">{t('sermonExitAdmin')}</span>
                <span aria-hidden className="sm:hidden">✕</span>
              </button>
            )}
            <LangToggle />
            <button
              type="button"
              onClick={() => {
                if (user) {
                  void signOut()
                  return
                }
                void signInWithGoogle().catch((error) => {
                  console.warn('Google sign-in failed.', error)
                })
              }}
              className="whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-bold text-rose-key/80 transition hover:text-rose-accent"
            >
              {user ? t('sermonLogout') : t('sermonLogin')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {adminMode && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border-2 border-rose-accent-deep/50 bg-rose-card p-3">
            <span className="flex items-center gap-1.5 font-serif text-sm font-extrabold text-rose-accent-deep">
              <span aria-hidden>🛡</span>
              {t('sermonAdminMode')}
            </span>
            <button
              type="button"
              onClick={openNewForm}
              className="rounded-full bg-rose-accent-deep px-3 py-1.5 text-[13px] font-bold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98]"
            >
              {t('sermonAdminNew')}
            </button>
          </div>
        )}

        {loading ? (
          <p className="py-12 text-center text-rose-key/70">{t('sermonLoading')}</p>
        ) : visibleSermons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-line bg-rose-card/60 py-16 text-center">
            <p className="font-serif text-lg font-bold text-rose-key">{t('sermonEmpty')}</p>
            <p className="mt-1 text-sm text-rose-key/70">{t('sermonEmptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {currentGroup.length > 0 && currentDate && (
              <section className="space-y-3">
                <header className="flex items-baseline gap-2">
                  <h2 className="font-serif text-xl font-extrabold text-rose-ink">
                    {t('sermonThisWeek')}
                  </h2>
                  <span className="text-sm font-bold text-rose-key">
                    {formatEntryDateDot(currentDate)}
                  </span>
                </header>
                <div className="space-y-3">{currentGroup.map(renderCard)}</div>
              </section>
            )}

            {pastDates.length > 0 && (
              <section className="space-y-4">
                <header className="flex items-baseline gap-2">
                  <h2 className="font-serif text-lg font-extrabold text-rose-key">
                    {t('sermonPastWeeks')}
                  </h2>
                  <span aria-hidden className="h-px flex-1 bg-rose-line" />
                </header>
                <div className="space-y-4">
                  {pastDates.map((date) => (
                    <div key={date} className="space-y-2">
                      <p className="text-sm font-bold text-rose-key/80">
                        {formatEntryDateDot(date)}
                      </p>
                      <div className="space-y-2">{(groups.get(date) ?? []).map(renderCard)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {formOpen && (
        <SermonAdminForm
          initial={editingSermon}
          onClose={closeForm}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  )
}
