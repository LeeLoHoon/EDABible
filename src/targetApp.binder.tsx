import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import BinderPage from './pages/BinderPage'

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
