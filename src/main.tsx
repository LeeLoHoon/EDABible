import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { clearBibleCache } from './bible'
import { flushPendingSaves } from './saveFlush'
import './index.css'
import App from 'virtual:target-app'

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

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    registration?.update()
    window.setInterval(
      () => {
        registration?.update()
      },
      60 * 60 * 1000,
    )
  },
  onNeedRefresh() {
    updateSW(true)
  },
  onOfflineReady() {},
})

async function removeRuntimeBibleCaches() {
  if (!('caches' in window)) return
  const names = await caches.keys()
  await Promise.all(names.filter((name) => name.startsWith('bible-json')).map((name) => caches.delete(name)))
}

async function ensureCurrentBuild() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}bible/build.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!response.ok) return

    const remote = (await response.json()) as { build?: string }
    if (!remote.build || remote.build === __BUILD__) return

    await clearBibleCache()
    await removeRuntimeBibleCaches()

    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    await registration?.update()
    updateSW(true)
    // 여기서 바로 reload하지 않는다 — 새 SW가 실제로 활성화되면 controllerchange
    // → reloadWhenSafe()가 한 번만 리로드한다. 구버전 SW에 갇힌 기기에서 SW
    // 설치가 끝나기 전에 리로드를 반복하던 무한 루프(필기 유실의 주범) 방지.
  } catch (error) {
    console.warn('Build freshness check failed.', error)
  }
}

if (__APP_TARGET__ !== 'binder') ensureCurrentBuild()

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
    <App />
  </StrictMode>,
)
