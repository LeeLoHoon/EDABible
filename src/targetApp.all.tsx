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
  { path: '/note', element: <HomePage /> },
  {
    path: '/binder',
    element: (
      <RequireGoogleLogin>
        <BinderPage />
      </RequireGoogleLogin>
    ),
  },
  { path: '/entry/:id', element: <EntryPage /> },
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
