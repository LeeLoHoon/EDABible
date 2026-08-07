import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider, RequireGoogleLogin } from './auth'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'

const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/entry/:id', element: <EntryPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function NoteApp() {
  return (
    <AuthProvider>
      {/* 묵상을 계정에 저장해 기기 간에 잇는다. 다만 이 타깃은 Supabase 없이 배포되는
          채널(GitHub Pages)이 있어, 그 경우엔 게이트를 통과시켜 로컬 전용으로 계속 쓴다. */}
      <RequireGoogleLogin variant="note" allowWithoutSupabase>
        <RouterProvider router={router} />
      </RequireGoogleLogin>
    </AuthProvider>
  )
}
