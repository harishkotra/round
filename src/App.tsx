import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Header } from '@/components/Header'
import { PrivacyBadge } from '@/components/PrivacyBadge'
import Home from '@/pages/Home'
import NewRound from '@/pages/NewRound'
import RoundPage from '@/pages/RoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewRound />} />
        <Route path="/round/:address" element={<RoundPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <footer className="mx-auto mt-12 max-w-5xl px-4 pb-8 text-center text-sm text-[var(--muted)]">
        Built by{' '}
        <a href="https://harishkotra.me" target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--accent)] hover:underline">
          Harish Kotra
        </a>
        {' · '}
        <a href="https://dailybuild.xyz" target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--accent)] hover:underline">
          Checkout my other builds
        </a>
      </footer>
      <PrivacyBadge />
    </BrowserRouter>
  )
}
