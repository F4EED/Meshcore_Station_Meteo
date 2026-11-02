import type { ReactNode } from 'react'
import { APP_VERSION } from '../protocol/codes'
import { useStation } from '../state/context'

export type PageId = 'meteo' | 'connexions' | 'reglages'

const LINKS: { id: PageId; href: string; label: string }[] = [
  { id: 'meteo', href: '/meteo', label: 'Météo' },
  { id: 'connexions', href: '/connexions', label: 'Connexions' },
  { id: 'reglages', href: '/reglages', label: 'Réglages' },
]

export function Shell({ page, onNavigate, children }: { page: PageId; onNavigate: (page: PageId) => void; children: ReactNode }) {
  const { status, linkLabel, linkKind } = useStation()
  const statusText = status === 'connected' ? linkLabel : status === 'connecting' ? 'Connexion…' : 'Hors ligne'
  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">F4EED · MeshCore</p>
          <h1>Station météo</h1>
        </div>
        <p className={`status status-${status}`} data-testid="link-status">
          <span className="dot" aria-hidden="true" />
          {statusText}
          {linkKind === 'demo' ? ' · simulé' : ''}
        </p>
      </header>
      <nav className="nav" aria-label="Pages">
        {LINKS.map((link) => (
          <a
            key={link.id}
            href={link.href}
            data-testid={`nav-${link.id}`}
            aria-current={page === link.id ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              onNavigate(link.id)
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <main>{children}</main>
      <footer>
        <span>Client {APP_VERSION}</span>
        <span>Mesures et indices, pas une prévision</span>
      </footer>
    </div>
  )
}
