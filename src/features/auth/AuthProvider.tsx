import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient, isSignupAllowed } from '../../lib/supabase/client'
import { getLocalRepository } from '../../persistence/local/repository'
import {
  AuthContext,
  translateAuthError,
  type AuthContextValue,
  type AuthResult,
  type AuthStatus,
  type AuthUser,
} from './AuthContext'

/**
 * Restores the persisted session on start-up and keeps it in sync with Supabase.
 *
 * The client is injectable so tests can drive authentication with a fake and never
 * reach a real project.
 */
export function AuthProvider({
  children,
  client = getSupabaseClient(),
  allowSignup = isSignupAllowed(),
}: {
  children: ReactNode
  client?: SupabaseClient | null
  allowSignup?: boolean
}): ReactNode {
  /**
   * `undefined` means "the persisted session has not been read yet"; `null` means
   * "read, and nobody is signed in". Keeping the distinction in one state value lets
   * the status be derived rather than set from inside an effect.
   */
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const adoptedFor = useRef<string | null>(null)

  const status: AuthStatus =
    client === null
      ? 'unconfigured'
      : user === undefined
        ? 'initialising'
        : user === null
          ? 'signed-out'
          : 'signed-in'

  useEffect(() => {
    if (client === null) return
    let active = true

    const toUser = (session: { user: { id: string; email?: string } } | null): AuthUser | null =>
      session === null ? null : { id: session.user.id, email: session.user.email ?? null }

    void client.auth.getSession().then(({ data }) => {
      if (active) setUser(toUser(data.session))
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(toUser(session))
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [client])

  // Work done before logging in belongs to the learner; re-own it once, per user.
  useEffect(() => {
    if (user === null || user === undefined || adoptedFor.current === user.id) return
    adoptedFor.current = user.id
    void getLocalRepository().adoptLocalData(user.id)
  }, [user])

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (client === null) return { ok: false, error: 'Aplikace není připojena k databázi.' }
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error !== null) return { ok: false, error: translateAuthError(error.message) }
      return { ok: true }
    },
    [client],
  )

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (client === null) return { ok: false, error: 'Aplikace není připojena k databázi.' }
      if (!allowSignup) return { ok: false, error: 'Registrace je v této instalaci vypnutá.' }
      const { error } = await client.auth.signUp({ email, password })
      if (error !== null) return { ok: false, error: translateAuthError(error.message) }
      return { ok: true }
    },
    [client, allowSignup],
  )

  const signOut = useCallback(async (): Promise<void> => {
    if (client === null) return
    await client.auth.signOut()
    adoptedFor.current = null
  }, [client])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: user ?? null, allowSignup, signIn, signUp, signOut }),
    [status, user, allowSignup, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
