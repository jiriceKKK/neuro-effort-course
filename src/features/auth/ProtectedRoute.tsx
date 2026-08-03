import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { LoginScreen } from './LoginScreen'
import { ConfigErrorScreen } from '../../app/ConfigErrorScreen'

/**
 * Gate for learning routes.
 *
 * While the persisted session is being restored the guard renders a loading state
 * rather than the login form, so a reload never looks like a logout.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): ReactNode {
  const { status } = useAuth()

  if (status === 'unconfigured') return <ConfigErrorScreen />

  if (status === 'initialising') {
    return (
      <div className="auth-screen">
        <p role="status" aria-live="polite">
          Načítám přihlášení…
        </p>
      </div>
    )
  }

  if (status === 'signed-out') return <LoginScreen />

  return children
}
