import { HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import BinderPage from './pages/BinderPage'
import MovedNotice from './components/MovedNotice'

// 바인더 폰트 재정의 활성화 — index.css의 :root.theme-binder를 켠다
// (색상은 note와 동일한 올리빈 팔레트 공유, theme-color도 index.html 값 그대로)
// 글꼴 자체는 BinderPage가 ensureBinderFont로 받아온다(통합 배포도 같은 글꼴을 쓴다).
document.documentElement.classList.add('theme-binder')

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
