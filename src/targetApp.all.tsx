import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'
import BinderPage from './pages/BinderPage'
import SermonPage from './pages/SermonPage'
import SermonNotePage from './pages/SermonNotePage'

export default function AllApp() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/binder"
            element={
              <RequireGoogleLogin>
                <BinderPage />
              </RequireGoogleLogin>
            }
          />
          <Route path="/entry/:id" element={<EntryPage />} />
          <Route path="/sermon" element={<SermonPage />} />
          <Route path="/sermon/:id" element={<SermonNotePage />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
