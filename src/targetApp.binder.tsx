import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import BinderPage from './pages/BinderPage'

// 바인더 그린 테마 활성화 — index.css의 :root.theme-binder 토큰 재정의를 켠다
document.documentElement.classList.add('theme-binder')
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f2f4ed')

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
