import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import LandingPage from './pages/LandingPage'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'
import BinderPage from './pages/BinderPage'
import SermonPage from './pages/SermonPage'
import SermonNotePage from './pages/SermonNotePage'
import SermonArchivePage from './pages/SermonArchivePage'
import QaPage from './pages/QaPage'
import QaThreadPage from './pages/QaThreadPage'

const router = createHashRouter([
  { path: '/', element: <LandingPage /> },
  // 묵상은 계정에 저장되어 기기 간에 이어진다 — 형광펜·필사가 이 기기에만 남지 않도록
  // 로그인 뒤에 연다. Supabase가 없는 배포에서는 동기화 자체가 불가능하므로 그냥 통과시킨다.
  {
    path: '/note',
    element: (
      <RequireGoogleLogin variant="note" allowWithoutSupabase>
        <HomePage />
      </RequireGoogleLogin>
    ),
  },
  {
    path: '/binder',
    element: (
      <RequireGoogleLogin>
        <BinderPage />
      </RequireGoogleLogin>
    ),
  },
  {
    path: '/entry/:id',
    element: (
      <RequireGoogleLogin variant="note" allowWithoutSupabase>
        <EntryPage />
      </RequireGoogleLogin>
    ),
  },
  { path: '/sermon', element: <SermonPage /> },
  // 정적 경로가 :id보다 먼저 매칭되도록 위에 둔다
  { path: '/sermon/archive', element: <SermonArchivePage /> },
  { path: '/sermon/:id', element: <SermonNotePage /> },
  { path: '/qa', element: <QaPage /> },
  { path: '/qa/:id', element: <QaThreadPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function AllApp() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
