import { useSyncExternalStore } from 'react'
import {
  getAppUpdateState,
  setAppUpdateRefreshing,
  subscribeToAppUpdate,
} from '../appUpdate'
import { t } from '../i18n/strings'

interface UpdateNoticeProps {
  onRefresh: () => Promise<void>
}

export default function UpdateNotice({ onRefresh }: UpdateNoticeProps) {
  const { latestVersion, refreshing } = useSyncExternalStore(
    subscribeToAppUpdate,
    getAppUpdateState,
    getAppUpdateState,
  )

  if (!latestVersion) return null

  const refresh = () => {
    if (refreshing) return
    setAppUpdateRefreshing(true)
    void onRefresh().catch((error) => {
      console.warn('App refresh failed.', error)
      setAppUpdateRefreshing(false)
    })
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-busy={refreshing}
      className="relative z-30 shrink-0 bg-rose-ink px-3 pb-2 text-white shadow-lg"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
        paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
        paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
      }}
    >
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="mx-auto flex min-h-11 w-full max-w-3xl items-center justify-between gap-3 rounded-xl px-2 text-left text-xs font-bold leading-5 transition active:bg-white/10 disabled:cursor-wait sm:px-3 sm:text-sm"
      >
        <span>
          {t('updateMessage')(latestVersion)}
        </span>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-rose-ink sm:text-[13px]">
          {refreshing ? t('updateRefreshing') : t('updateRefresh')}
        </span>
      </button>
    </aside>
  )
}
