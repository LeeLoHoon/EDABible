import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { announceAppUpdate, isNewerVersion } from './appUpdate'
import { clearBibleCache } from './bible'
import UpdateNotice from './components/UpdateNotice'
import { flushPendingSaves } from './saveFlush'
import './index.css'
import App from 'virtual:target-app'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

let reloadingForServiceWorker = false

// 새 SW가 활성화돼도 필기 중(ink-active: 노트·바인더 잉크 엔진이 관리)에는
// 리로드를 보류하고, 리로드 직전에 대기 중인 저장을 확정한다 — 설치형
// PWA에서 업데이트 리로드가 필기 도중에 터져 방금 쓴 글씨가 날아가는 것 방지.
async function reloadWhenSafe() {
  if (reloadingForServiceWorker) return
  reloadingForServiceWorker = true
  while (document.body.classList.contains('ink-active')) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await flushPendingSaves()
  window.location.reload()
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
    await reloadWhenSafe()
    return
  }

  const previousController = navigator.serviceWorker.controller
  await registration.update()

  const installingWorker = registration.installing
  if (installingWorker) await waitForInstallingWorker(installingWorker)

  const waitingWorker = registration.waiting
  if (!waitingWorker) {
    if (navigator.serviceWorker.controller !== previousController) {
      await reloadWhenSafe()
      return
    }
    throw new Error('The updated service worker is not ready yet.')
  }

  if (__APP_TARGET__ !== 'binder') {
    await clearBibleCache()
    await removeRuntimeBibleCaches()
  }

  await activateWaitingWorker(waitingWorker)
  await reloadWhenSafe()
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

// iOS: 펜 필기 중 손바닥이 본문 글자에 닿으면 텍스트가 선택되며
// "링크 만들기" 콜아웃이 뜬다. CSS(user-select:none)만으로는 애플펜슬/
// 롱프레스 선택이 안 막히므로, 입력칸을 제외한 선택·컨텍스트메뉴를 차단.
const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

// 이벤트 대상이 .selectable-text(성경 본문 등) 안에 있는지
const inSelectableText = (el: EventTarget | null): boolean => {
  const node = el instanceof Element ? el : el instanceof Node ? el.parentElement : null
  return !!node?.closest('.selectable-text')
}

// 대상이 입력칸/본문이거나, 입력칸이 포커스된 상태면 차단하지 않는다
// (입력칸 포커스 중 selectstart를 막으면 iOS에서 키보드/편집이 깨짐)
const allowSelect = (e: Event) =>
  isEditable(e.target) ||
  isEditable(document.activeElement) ||
  (!document.body.classList.contains('ink-active') && inSelectableText(e.target))

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
