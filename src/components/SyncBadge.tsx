import type { ReactNode } from 'react'
import { SYNC_STATUS_LABELS, type SyncStatus } from '../types/learner'

/** Czech synchronisation indicator. Status is carried by text, not colour alone. */
export function SyncBadge({
  status,
  pendingCount,
}: {
  status: SyncStatus
  pendingCount: number
}): ReactNode {
  const label = SYNC_STATUS_LABELS[status]
  const suffix = status === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''

  return (
    <span className={`badge badge--${status}`} role="status" aria-live="polite">
      {label}
      {suffix}
    </span>
  )
}
