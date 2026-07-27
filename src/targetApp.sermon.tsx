import { HashRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
import SermonPage from './pages/SermonPage'
import SermonNotePage from './pages/SermonNotePage'

// 로그인 게이트 없이 연다 — 교인은 바로 열람·묵상(기기 저장)하고,
// 설교 등록 관리자만 목록 화면의 로그인 버튼으로 계정 동기화를 켠다.
export default function SermonApp() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<SermonPage />} />
          <Route path="/sermon/:id" element={<SermonNotePage />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
