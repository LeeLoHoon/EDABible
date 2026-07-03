import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import BinderPage from './pages/BinderPage'

// 바인더 그린 테마 활성화 — index.css의 :root.theme-binder 토큰 재정의를 켠다
document.documentElement.classList.add('theme-binder')
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f2f4ed')

// 바인더 폰트: SPL PDF와 같은 모던 고딕(Pretendard) — dynamic subset이라
// 화면에 쓰인 글리프만 내려받는다. 오프라인이면 시스템 고딕으로 폴백.
const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'
document.head.appendChild(fontLink)

export default function BinderApp() {
  return (
    <AuthProvider>
      <RequireGoogleLogin>
        <HashRouter>
          <Routes>
            <Route path="/" element={<BinderPage />} />
            <Route path="/binder" element={<BinderPage />} />
          </Routes>
        </HashRouter>
      </RequireGoogleLogin>
    </AuthProvider>
  )
}
