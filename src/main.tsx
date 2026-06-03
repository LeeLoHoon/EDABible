import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true)
  },
  onOfflineReady() {},
})

// iOS: 펜 필기 중 손바닥이 본문 글자에 닿으면 텍스트가 선택되며
// "링크 만들기" 콜아웃이 뜬다. CSS(user-select:none)만으로는 애플펜슬/
// 롱프레스 선택이 안 막히므로, 입력칸을 제외한 선택·컨텍스트메뉴를 차단.
const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

document.addEventListener(
  'selectstart',
  (e) => {
    if (!isEditable(e.target)) e.preventDefault()
  },
  { passive: false },
)
document.addEventListener('contextmenu', (e) => {
  if (!isEditable(e.target)) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
