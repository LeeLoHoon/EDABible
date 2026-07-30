import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'
import BinderPage from './pages/BinderPage'

const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/binder', element: <BinderPage /> },
  { path: '/entry/:id', element: <EntryPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
