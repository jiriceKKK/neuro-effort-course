import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useSync } from '../persistence/sync/syncContext'
import { SyncBadge } from '../components/SyncBadge'

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Přehled', end: true },
  { to: '/kurz', label: 'Mapa kurzu' },
  { to: '/opakovani', label: 'Opakování' },
  { to: '/postup', label: 'Postup' },
  { to: '/nastaveni', label: 'Nastavení' },
]

export function AppLayout(): ReactNode {
  const { state } = useSync()

  return (
    <div className="app-shell">
      <a className="visually-hidden" href="#obsah">
        Přeskočit na hlavní obsah
      </a>

      <header className="app-header">
        <div className="app-header__row">
          <p className="app-header__title">Neurokognitivní psychologie úsilí</p>
          <SyncBadge status={state.status} pendingCount={state.pendingCount} />
        </div>
      </header>

      <nav className="app-nav" aria-label="Hlavní navigace">
        <ul className="app-nav__list">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink className="app-nav__link" to={item.to} end={item.end ?? false}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="app-main" id="obsah">
        <Outlet />
      </main>

      <footer className="app-footer">
        <p className="meta-line">
          Ukázková verze kurzu. Obsah zatím neprošel finálním odborným auditem.
        </p>
      </footer>
    </div>
  )
}
