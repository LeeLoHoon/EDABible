import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'

const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/entry/:id', element: <EntryPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function NoteApp() {
  return <RouterProvider router={router} />
}
