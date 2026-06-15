import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import EntryPage from './pages/EntryPage'
import ReviewPage from './pages/ReviewPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/entry/:id" element={<EntryPage />} />
        <Route path="/review" element={<ReviewPage />} />
      </Routes>
    </HashRouter>
  )
}
