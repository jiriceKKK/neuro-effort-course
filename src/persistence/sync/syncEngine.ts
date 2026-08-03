import type { LocalRepository } from '../local/repository'
import type { RemoteRepository } from '../remote/remoteRepository'
import { parseCompositeKey } from '../local/ids'
import type { OutboxRecord, SyncStatus } from '../../types/learner'

/**
 * Outbox-driven synchronisation.
 *
 * Rules that must not be broken:
 *  - local data is never deleted because a remote request failed;
 *  - every push is idempotent, so a retry after an ambiguous failure is always safe;
 *  - retries use bounded exponential backoff and eventually park the entry as `failed`,
 *    where „Synchronizovat nyní“ can pick it up again.
 *
 * Triggers live in `SyncProvider`: app start, login, `online`, a new local write, and
 * the manual button.
 */

export interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

export interface SyncOutcome {
  pushed: number
  failed: number
  skipped: number
}

export interface SyncEngineOptions {
  local: LocalRepository
  /** `null` while signed out or unconfigured — work stays queued locally. */
  getRemote: () => RemoteRepository | null
  getUserId: () => string | null
  isOnline: () => boolean
  clock?: () => Date
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 6
const DEFAULT_BASE_DELAY_MS = 5_000
const DEFAULT_MAX_DELAY_MS = 5 * 60_000
const SYNCED_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class SyncEngine {
  private readonly local: LocalRepository
  private readonly getRemote: () => RemoteRepository | null
  private readonly getUserId: () => string | null
  private readonly isOnline: () => boolean
  private readonly clock: () => Date
  private readonly maxAttempts: number
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number

  private state: SyncState = {
    status: 'pending',
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  }
  private listeners = new Set<(state: SyncState) => void>()
  private running: Promise<SyncOutcome> | null = null

  constructor(options: SyncEngineOptions) {
    this.local = options.local
    this.getRemote = options.getRemote
    this.getUserId = options.getUserId
    this.isOnline = options.isOnline
    this.clock = options.clock ?? (() => new Date())
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  }

  getState(): SyncState {
    return this.state
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  /** Recomputes the badge without pushing anything. */
  async refreshStatus(): Promise<void> {
    const pendingCount = await this.local.countUnsynced()
    if (!this.isOnline()) {
      this.setState({ pendingCount, status: 'offline' })
      return
    }
    if (this.getRemote() === null || this.getUserId() === null) {
      this.setState({ pendingCount, status: pendingCount > 0 ? 'pending' : 'synced' })
      return
    }
    this.setState({ pendingCount, status: pendingCount > 0 ? 'pending' : 'synced' })
  }

  private backoffMs(attempts: number): number {
    return Math.min(this.baseDelayMs * 2 ** attempts, this.maxDelayMs)
  }

  /** Runs a sync pass; concurrent calls share the in-flight run. */
  async sync(): Promise<SyncOutcome> {
    if (this.running !== null) return this.running
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Retries parked entries as well — used by the manual „Synchronizovat nyní“ button. */
  async syncNow(): Promise<SyncOutcome> {
    await this.local.retryFailed()
    return this.sync()
  }

  private async run(): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { pushed: 0, failed: 0, skipped: 0 }

    if (!this.isOnline()) {
      await this.refreshStatus()
      this.setState({ status: 'offline' })
      return outcome
    }

    const remote = this.getRemote()
    const userId = this.getUserId()
    if (remote === null || userId === null) {
      await this.refreshStatus()
      return outcome
    }

    const pending = await this.local.listPendingOutbox(this.clock())
    if (pending.length === 0) {
      await this.local.pruneSyncedOutbox(new Date(this.clock().getTime() - SYNCED_RECEIPT_TTL_MS))
      this.setState({
        status: 'synced',
        pendingCount: await this.local.countUnsynced(),
        lastSyncedAt: this.clock().toISOString(),
        lastError: null,
      })
      return outcome
    }

    this.setState({ status: 'syncing', pendingCount: pending.length })

    for (const record of pending) {
      await this.local.markOutbox(record.id, { status: 'syncing' })
      try {
        const handled = await this.push(record, remote, userId)
        if (handled) outcome.pushed += 1
        else outcome.skipped += 1
        await this.local.markOutbox(record.id, { status: 'synced', lastError: null })
      } catch (error) {
        outcome.failed += 1
        const attempts = record.attempts + 1
        const message = error instanceof Error ? error.message : String(error)
        await this.local.markOutbox(record.id, {
          status: attempts >= this.maxAttempts ? 'failed' : 'pending',
          attempts,
          nextAttemptAt: new Date(this.clock().getTime() + this.backoffMs(attempts)).toISOString(),
          lastError: message,
        })
        this.setState({ lastError: message })
      }
    }

    await this.local.pruneSyncedOutbox(new Date(this.clock().getTime() - SYNCED_RECEIPT_TTL_MS))
    const pendingCount = await this.local.countUnsynced()
    this.setState({
      pendingCount,
      status: outcome.failed > 0 ? 'error' : pendingCount > 0 ? 'pending' : 'synced',
      lastSyncedAt: outcome.failed > 0 ? this.state.lastSyncedAt : this.clock().toISOString(),
      lastError: outcome.failed > 0 ? this.state.lastError : null,
    })
    return outcome
  }

  /**
   * Pushes one outbox entry.
   *
   * @returns `false` when the referenced row no longer exists locally or belongs to a
   *   different user; the entry is then retired without contacting the server.
   */
  private async push(
    record: OutboxRecord,
    remote: RemoteRepository,
    userId: string,
  ): Promise<boolean> {
    switch (record.entityType) {
      case 'learner_event': {
        const events = await this.local.listEvents(userId)
        const event = events.find((candidate) => candidate.id === record.entityKey)
        if (event === undefined) return false
        await remote.pushLearnerEvent(event)
        return true
      }
      case 'question_attempt': {
        const attempts = await this.local.listAttempts(userId)
        const attempt = attempts.find((candidate) => candidate.id === record.entityKey)
        if (attempt === undefined) return false
        await remote.pushQuestionAttempt(attempt)
        return true
      }
      case 'lesson_progress': {
        const { userId: owner, secondary } = parseCompositeKey(record.entityKey)
        if (owner !== userId) return false
        const progress = await this.local.getLessonProgress(owner, secondary)
        if (progress === null) return false
        await remote.pushLessonProgress(progress)
        return true
      }
      case 'review_state': {
        const { userId: owner, secondary } = parseCompositeKey(record.entityKey)
        if (owner !== userId) return false
        const state = await this.local.getReviewState(owner, secondary)
        if (state === null) return false
        await remote.pushReviewState(state)
        return true
      }
      case 'personal_note': {
        const notes = await this.local.listPersonalNotes(userId)
        const note = notes.find((candidate) => candidate.id === record.entityKey)
        if (note === undefined) return false
        await remote.pushPersonalNote(note)
        return true
      }
      case 'user_settings': {
        if (record.entityKey !== userId) return false
        await remote.pushUserSettings(await this.local.getUserSettings(userId))
        return true
      }
    }
  }
}
