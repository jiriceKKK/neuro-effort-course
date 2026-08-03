import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SyncEngine, type SyncState } from './syncEngine'
import { SyncContext, type SyncContextValue } from './syncContext'
import { getLocalRepository } from '../local/repository'
import { getSupabaseClient } from '../../lib/supabase/client'
import { SupabaseRemoteRepository, type RemoteRepository } from '../remote/remoteRepository'
import { useAuth } from '../../features/auth/AuthContext'
import { LOCAL_USER_ID } from '../../types/learner'

/**
 * Wires the sync engine to the events that should trigger a push:
 * application start, login, returning online, a new local write, and the manual
 * „Synchronizovat nyní“ button.
 *
 * The engine is rebuilt when the signed-in user changes, which also drops the cached
 * remote repository — a session must never push with the previous user's credentials.
 */

const LOCAL_CHANGE_DEBOUNCE_MS = 1_500

function defaultRemoteFactory(): RemoteRepository | null {
  const client = getSupabaseClient()
  return client === null ? null : new SupabaseRemoteRepository(client)
}

export function SyncProvider({
  children,
  remoteFactory = defaultRemoteFactory,
}: {
  children: ReactNode
  /** Injectable so tests never construct a real Supabase repository. */
  remoteFactory?: () => RemoteRepository | null
}): ReactNode {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const engine = useMemo(() => {
    let cached: RemoteRepository | null | undefined

    return new SyncEngine({
      local: getLocalRepository(),
      // While signed out there is nowhere to push to; work stays in the local outbox.
      getRemote: () => {
        if (userId === null || userId === LOCAL_USER_ID) return null
        cached ??= remoteFactory()
        return cached
      },
      getUserId: () => userId,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    })
  }, [remoteFactory, userId])

  const [state, setState] = useState<SyncState>(engine.getState())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => engine.subscribe(setState), [engine])

  // Application start, and every login or logout (the engine identity changes with it).
  useEffect(() => {
    void engine.sync()
  }, [engine])

  useEffect(() => {
    const handleOnline = (): void => {
      void engine.sync()
    }
    const handleOffline = (): void => {
      void engine.refreshStatus()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [engine])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const notifyLocalChange = useCallback(() => {
    void engine.refreshStatus()
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void engine.sync()
    }, LOCAL_CHANGE_DEBOUNCE_MS)
  }, [engine])

  const syncNow = useCallback(async () => {
    await engine.syncNow()
  }, [engine])

  const value = useMemo<SyncContextValue>(
    () => ({ state, syncNow, notifyLocalChange }),
    [state, syncNow, notifyLocalChange],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
