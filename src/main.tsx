import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { announceAppUpdate, isNewerVersion } from './appUpdate'
import { clearBibleCache } from './bible'
import { isBibleCopyEnabled } from './bibleCopy'
import UpdateNotice from './components/UpdateNotice'
import { pruneRemovedBibleVersionCaches } from './db'
import { getLang } from './i18n/lang'
import { flushPendingSaves } from './saveFlush'
import './index.css'
import App from 'virtual:target-app'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

document.documentElement.lang = getLang()

void pruneRemovedBibleVersionCaches().catch((error) => {
  console.warn('Removed Bible version cache pruning failed.', error)
})

let reloadingForServiceWorker = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

// 새 SW가 활성화돼도 필기 중(ink-active: 노트·바인더 잉크 엔진이 관리)에는
// 리로드를 보류하고, 리로드 직전에 대기 중인 저장을 확정한다 — 설치형
// PWA에서 업데이트 리로드가 필기 도중에 터져 방금 쓴 글씨가 날아가는 것 방지.
async function reloadWhenSafe(): Promise<boolean> {
  if (reloadingForServiceWorker) return false
  reloadingForServiceWorker = true
  try {
    while (document.body.classList.contains('ink-active')) await sleep(500)
    try {
      await flushPendingSaves()
    } catch {
      await sleep(1000)
      await flushPendingSaves()
    }
  } catch (error) {
    console.warn('Pending saves are unfinished; the update reload was cancelled.', error)
    reloadingForServiceWorker = false
    return false
  }
  window.location.reload()
  return true
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    void reloadWhenSafe()
  })
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    void registration?.update()
    window.setInterval(
      () => {
        void registration?.update()
      },
      UPDATE_CHECK_INTERVAL_MS,
    )
  },
  onNeedRefresh() {
    void checkForAppUpdate()
  },
  onNeedReload() {
    void reloadWhenSafe()
  },
  onOfflineReady() {},
})

async function removeRuntimeBibleCaches() {
  if (!('caches' in window)) return
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.startsWith('bible-json')).map((name) => caches.delete(name)))
}

let updateCheck: Promise<void> | null = null

function checkForAppUpdate(): Promise<void> {
  if (import.meta.env.DEV) return Promise.resolve()
  if (updateCheck) return updateCheck

  updateCheck = (async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10_000)

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return

      const remote = (await response.json()) as { version?: unknown; target?: unknown }
      if (
        remote.target !== __APP_TARGET__ ||
        typeof remote.version !== 'string' ||
        !isNewerVersion(remote.version, __BUILD__)
      )
        return

      announceAppUpdate(remote.version)

      const registration =
        'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      await registration?.update()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Build freshness check failed.', error)
      }
    } finally {
      window.clearTimeout(timeout)
    }
  })().finally(() => {
    updateCheck = null
  })

  return updateCheck
}

function waitForInstallingWorker(worker: ServiceWorker, timeoutMs = 30_000): Promise<void> {
  if (worker.state === 'installed' || worker.state === 'activated') return Promise.resolve()

  return new Promise((resolve, reject) => {
    let timer = 0

    const cleanup = () => {
      window.clearTimeout(timer)
      worker.removeEventListener('statechange', handleStateChange)
    }

    const handleStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated') {
        cleanup()
        resolve()
      } else if (worker.state === 'redundant') {
        cleanup()
        reject(new Error('The updated service worker could not be installed.'))
      }
    }

    worker.addEventListener('statechange', handleStateChange)
    timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while installing the updated service worker.'))
    }, timeoutMs)
    handleStateChange()
  })
}

function activateWaitingWorker(worker: ServiceWorker, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer = 0

    const cleanup = () => {
      window.clearTimeout(timer)
      worker.removeEventListener('statechange', handleStateChange)
    }

    const handleStateChange = () => {
      if (worker.state === 'activated') {
        cleanup()
        resolve()
      } else if (worker.state === 'redundant') {
        cleanup()
        reject(new Error('The updated service worker could not be activated.'))
      }
    }

    worker.addEventListener('statechange', handleStateChange)
    timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while activating the updated service worker.'))
    }, timeoutMs)
    try {
      worker.postMessage({ type: 'SKIP_WAITING' })
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    handleStateChange()
  })
}

async function refreshToLatestBuild() {
  const registration =
    'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined

  if (!registration) {
    if (__APP_TARGET__ !== 'binder') {
      await clearBibleCache()
      await removeRuntimeBibleCaches()
    }
    if (!(await reloadWhenSafe())) throw new Error('PENDING_SAVES_FAILED')
    return
  }

  const previousController = navigator.serviceWorker.controller
  await registration.update()

  const installingWorker = registration.installing
  if (installingWorker) await waitForInstallingWorker(installingWorker)

  const waitingWorker = registration.waiting
  if (!waitingWorker) {
    if (navigator.serviceWorker.controller !== previousController) {
      if (!(await reloadWhenSafe())) throw new Error('PENDING_SAVES_FAILED')
      return
    }
    throw new Error('The updated service worker is not ready yet.')
  }

  if (__APP_TARGET__ !== 'binder') {
    await clearBibleCache()
    await removeRuntimeBibleCaches()
  }

  await activateWaitingWorker(waitingWorker)
  if (!(await reloadWhenSafe())) throw new Error('PENDING_SAVES_FAILED')
}

void checkForAppUpdate()
window.setInterval(() => {
  void checkForAppUpdate()
}, UPDATE_CHECK_INTERVAL_MS)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForAppUpdate()
})
window.addEventListener('online', () => {
  void checkForAppUpdate()
})

// iOS: CSS(user-select:none)만으로는 애플펜슬/롱프레스 선택과 콜아웃이
// 완전히 막히지 않는다. 입력칸은 정상 편집되게 두되 성경 본문은 입력칸이
// 포커스된 상태에서도 항상 선택·복사·컨텍스트메뉴를 차단한다.
const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

const inProtectedBibleText = (el: EventTarget | null): boolean => {
  const node = el instanceof Element ? el : el instanceof Node ? el.parentElement : null
  return !!node?.closest('.protected-bible-text')
}

// 입력칸 포커스 중 selectstart를 모두 막으면 iOS 키보드/편집이 깨진다.
// 단, 이벤트 대상이 성경 본문이면 포커스 상태보다 본문 보호를 우선한다.
const allowSelect = (e: Event) => {
  const protectedBibleText = inProtectedBibleText(e.target)
  if (protectedBibleText) return isBibleCopyEnabled()
  return isEditable(e.target) || isEditable(document.activeElement)
}

const selectionTouchesProtectedBibleText = (): boolean => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return false
  if (
    inProtectedBibleText(selection.anchorNode) ||
    inProtectedBibleText(selection.focusNode)
  ) {
    return true
  }

  // Ctrl/Cmd+A처럼 선택 경계가 body에 있어도 본문을 포함하면 복사를 막는다.
  for (const root of document.querySelectorAll('.protected-bible-text')) {
    if (selection.containsNode(root, true)) return true
  }
  return false
}

const preventProtectedCopy = (e: ClipboardEvent) => {
  if (isBibleCopyEnabled()) return
  if (inProtectedBibleText(e.target) || selectionTouchesProtectedBibleText()) {
    e.preventDefault()
  }
}

document.addEventListener(
  'selectstart',
  (e) => {
    if (!allowSelect(e)) e.preventDefault()
  },
  { passive: false },
)
document.addEventListener('contextmenu', (e) => {
  if (!allowSelect(e)) e.preventDefault()
})
document.addEventListener('copy', preventProtectedCopy)
document.addEventListener('cut', preventProtectedCopy)
document.addEventListener('dragstart', (e) => {
  if (!isBibleCopyEnabled() && inProtectedBibleText(e.target)) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex h-full flex-col">
      <UpdateNotice onRefresh={refreshToLatestBuild} />
      <div className="min-h-0 flex-1">
        <App />
      </div>
    </div>
  </StrictMode>,
)
