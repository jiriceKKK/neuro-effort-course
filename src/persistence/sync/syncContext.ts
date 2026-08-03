import { createContext, useContext } from 'react'
import type { SyncState } from './syncEngine'

/**
 * Kept separate from `SyncProvider.tsx` so that file exports only a component and
 * React Fast Refresh keeps working during development.
 */
export interface SyncContextValue {
  state: SyncState
  /** Manual trigger; also revives entries parked as `failed`. */
  syncNow(): Promise<void>
  /** Called by writers so a push follows shortly after a local change. */
  notifyLocalChange(): void
}

export const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext)
  if (value === null) throw new Error('useSync musí být použit uvnitř SyncProvider.')
  return value
}
