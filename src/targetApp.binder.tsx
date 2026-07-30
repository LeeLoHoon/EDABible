import { HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import BinderPage from './pages/BinderPage'
import MovedNotice from './components/MovedNotice'

// 바인더 폰트 재정의 활성화 — index.css의 :root.theme-binder를 켠다
// (색상은 note와 동일한 올리빈 팔레트 공유, theme-color도 index.html 값 그대로)
document.documentElement.classList.add('theme-binder')

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
      <MovedNotice path="/binder" />
      <RequireGoogleLogin>
        <HashRouter>
          <Routes>
            <Route path="/" element={<BinderPage />} />
            <Route path="/binder" element={<BinderPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </RequireGoogleLogin>
    </AuthProvider>
  )
}
