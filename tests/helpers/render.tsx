import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '../../src/features/auth/AuthContext'
import { SyncProvider } from '../../src/persistence/sync/SyncProvider'
import { LearningDatabase, setDatabase } from '../../src/persistence/local/db'
import { setLocalRepository } from '../../src/persistence/local/repository'
import { newUuid } from '../../src/persistence/local/ids'

/**
 * Test harness.
 *
 * Authentication is injected directly and the sync engine is given a `null` remote, so
 * no test can reach a real Supabase project — writes stay queued in the local outbox,
 * which is exactly the offline path we want exercised.
 */

export function makeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'signed-in',
    user: { id: 'test-user', email: 'ucastnik@example.com' },
    allowSignup: false,
    signIn: async () => ({ ok: true }),
    signUp: async () => ({ ok: true }),
    signOut: async () => undefined,
    ...overrides,
  }
}

/** Fresh IndexedDB per test; returns the database so a test can assert on it. */
export async function useFreshDatabase(): Promise<LearningDatabase> {
  const db = new LearningDatabase(`ui-${newUuid()}`)
  await db.open()
  setDatabase(db)
  setLocalRepository(null)
  return db
}

const noRemote = () => null

export function TestProviders({
  children,
  auth = makeAuthValue(),
  initialEntries = ['/'],
  path = '*',
}: {
  children: ReactNode
  auth?: AuthContextValue
  initialEntries?: string[]
  path?: string
}): ReactNode {
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={initialEntries}>
        <SyncProvider remoteFactory={noRemote}>
          <Routes>
            <Route path={path} element={children} />
          </Routes>
        </SyncProvider>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}
