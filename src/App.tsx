import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'
import BinderPage from './pages/BinderPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/binder" element={<BinderPage />} />
        <Route path="/entry/:id" element={<EntryPage />} />
      </Routes>
    </HashRouter>
  )
}
