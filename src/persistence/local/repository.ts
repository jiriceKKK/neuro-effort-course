import { getDatabase, type LearningDatabase } from './db'
import { compositeKey, newUuid } from './ids'
import {
  DEFAULT_USER_SETTINGS,
  LOCAL_USER_ID,
  type AttemptDraft,
  type JsonObject,
  type LearnerEvent,
  type LearnerEventType,
  type LessonProgress,
  type LessonStatus,
  type OutboxRecord,
  type PersonalNote,
  type QuestionAttempt,
  type ReviewState,
  type SyncEntityType,
  type UserSettings,
} from '../../types/learner'

/**
 * The only way the application touches IndexedDB.
 *
 * Two invariants hold for every method that changes syncable data:
 *  1. the local write and the outbox entry happen in one Dexie transaction, so a
 *     record can never be stored without being queued;
 *  2. append-only tables (`learnerEvents`, `questionAttempts`) are never updated.
 */

const DEVICE_ID_KEY = 'deviceId'

export interface AppendEventInput {
  userId: string
  eventType: LearnerEventType
  lessonId?: string | null
  blockId?: string | null
  conceptId?: string | null
  questionId?: string | null
  payload?: JsonObject
  occurredAt?: string
}

export interface RecordAttemptInput {
  userId: string
  questionId: string
  lessonId: string
  conceptIds: string[]
  selectedOptionId?: string | null
  freeResponse?: string | null
  correctness?: QuestionAttempt['correctness']
  confidence?: number | null
  hintUsed?: boolean
  responseTimeMs: number
}

export interface LessonProgressPatch {
  status?: LessonStatus
  currentBlockIndex?: number
  startedAt?: string | null
  completedAt?: string | null
  activeTimeMs?: number
  lastOpenedAt?: string | null
}

export class LocalRepository {
  private readonly db: LearningDatabase
  private readonly clock: () => Date

  constructor(db: LearningDatabase = getDatabase(), clock: () => Date = () => new Date()) {
    this.db = db
    this.clock = clock
  }

  private now(): string {
    return this.clock().toISOString()
  }

  // ── device identity ──────────────────────────────────────────────────────────

  /** Stable per-installation ID, generated once and reused for every event. */
  async getDeviceId(): Promise<string> {
    const existing = await this.db.meta.get(DEVICE_ID_KEY)
    if (existing !== undefined) return existing.value
    const value = newUuid()
    await this.db.meta.put({ key: DEVICE_ID_KEY, value })
    return value
  }

  // ── outbox ───────────────────────────────────────────────────────────────────

  /**
   * Queues a row for synchronisation.
   *
   * Upsert entities collapse: if an unsent entry for the same row already exists it is
   * reused, because the pusher always reads the current local state at push time.
   */
  private async enqueue(
    entityType: SyncEntityType,
    entityKey: string,
    operation: OutboxRecord['operation'],
  ): Promise<void> {
    const timestamp = this.now()
    if (operation === 'upsert') {
      const existing = await this.db.outbox
        .where('[entityType+entityKey]')
        .equals([entityType, entityKey])
        .filter((record) => record.status === 'pending' || record.status === 'failed')
        .first()
      if (existing !== undefined) {
        await this.db.outbox.update(existing.id, {
          status: 'pending',
          nextAttemptAt: timestamp,
          updatedAt: timestamp,
        })
        return
      }
    }

    await this.db.outbox.put({
      id: newUuid(),
      entityType,
      entityKey,
      operation,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: timestamp,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  async listPendingOutbox(now: Date = this.clock()): Promise<OutboxRecord[]> {
    const records = await this.db.outbox
      .where('status')
      .anyOf('pending', 'syncing')
      .toArray()
    return records
      .filter((record) => new Date(record.nextAttemptAt).getTime() <= now.getTime())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async countUnsynced(): Promise<number> {
    return this.db.outbox.where('status').anyOf('pending', 'syncing', 'failed').count()
  }

  async markOutbox(
    id: string,
    patch: Partial<Pick<OutboxRecord, 'status' | 'attempts' | 'nextAttemptAt' | 'lastError'>>,
  ): Promise<void> {
    await this.db.outbox.update(id, { ...patch, updatedAt: this.now() })
  }

  /** Moves `failed` entries back to `pending` — used by „Synchronizovat nyní“. */
  async retryFailed(): Promise<number> {
    const failed = await this.db.outbox.where('status').equals('failed').toArray()
    const timestamp = this.now()
    await this.db.outbox.bulkPut(
      failed.map((record) => ({
        ...record,
        status: 'pending' as const,
        nextAttemptAt: timestamp,
        updatedAt: timestamp,
      })),
    )
    return failed.length
  }

  /** Housekeeping only: synced entries are receipts, the learner data itself stays. */
  async pruneSyncedOutbox(olderThan: Date): Promise<number> {
    const cutoff = olderThan.toISOString()
    const stale = await this.db.outbox
      .where('status')
      .equals('synced')
      .filter((record) => record.updatedAt < cutoff)
      .toArray()
    await this.db.outbox.bulkDelete(stale.map((record) => record.id))
    return stale.length
  }

  // ── lesson progress ──────────────────────────────────────────────────────────

  async getLessonProgress(userId: string, lessonId: string): Promise<LessonProgress | null> {
    return (await this.db.lessonProgress.get([userId, lessonId])) ?? null
  }

  async listLessonProgress(userId: string): Promise<LessonProgress[]> {
    return this.db.lessonProgress.where('userId').equals(userId).toArray()
  }

  async updateLessonProgress(
    userId: string,
    lessonId: string,
    patch: LessonProgressPatch,
  ): Promise<LessonProgress> {
    const timestamp = this.now()
    let result: LessonProgress | null = null

    await this.db.transaction('rw', this.db.lessonProgress, this.db.outbox, async () => {
      const existing = await this.db.lessonProgress.get([userId, lessonId])
      const next: LessonProgress = {
        userId,
        lessonId,
        status: patch.status ?? existing?.status ?? 'not_started',
        currentBlockIndex: patch.currentBlockIndex ?? existing?.currentBlockIndex ?? 0,
        startedAt: patch.startedAt ?? existing?.startedAt ?? null,
        completedAt: patch.completedAt ?? existing?.completedAt ?? null,
        activeTimeMs: patch.activeTimeMs ?? existing?.activeTimeMs ?? 0,
        lastOpenedAt: patch.lastOpenedAt ?? existing?.lastOpenedAt ?? null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await this.db.lessonProgress.put(next)
      await this.enqueue('lesson_progress', compositeKey(userId, lessonId), 'upsert')
      result = next
    })

    if (result === null) throw new Error('Uložení postupu v lekci selhalo.')
    return result
  }

  // ── append-only tables ───────────────────────────────────────────────────────

  async appendEvent(input: AppendEventInput): Promise<LearnerEvent> {
    const deviceId = await this.getDeviceId()
    const timestamp = this.now()
    const event: LearnerEvent = {
      id: newUuid(),
      userId: input.userId,
      deviceId,
      eventType: input.eventType,
      lessonId: input.lessonId ?? null,
      blockId: input.blockId ?? null,
      conceptId: input.conceptId ?? null,
      questionId: input.questionId ?? null,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? timestamp,
      createdAt: timestamp,
    }

    await this.db.transaction('rw', this.db.learnerEvents, this.db.outbox, async () => {
      await this.db.learnerEvents.add(event)
      await this.enqueue('learner_event', event.id, 'insert')
    })
    return event
  }

  async listEvents(userId: string): Promise<LearnerEvent[]> {
    return this.db.learnerEvents.where('userId').equals(userId).toArray()
  }

  async nextAttemptNumber(userId: string, questionId: string): Promise<number> {
    const previous = await this.db.questionAttempts
      .where('questionId')
      .equals(questionId)
      .filter((attempt) => attempt.userId === userId)
      .count()
    return previous + 1
  }

  async recordAttempt(input: RecordAttemptInput): Promise<QuestionAttempt> {
    const attemptNumber = await this.nextAttemptNumber(input.userId, input.questionId)
    const attempt: QuestionAttempt = {
      id: newUuid(),
      userId: input.userId,
      questionId: input.questionId,
      lessonId: input.lessonId,
      conceptIds: input.conceptIds,
      selectedOptionId: input.selectedOptionId ?? null,
      freeResponse: input.freeResponse ?? null,
      correctness: input.correctness ?? null,
      confidence: input.confidence ?? null,
      hintUsed: input.hintUsed ?? false,
      responseTimeMs: input.responseTimeMs,
      attemptNumber,
      createdAt: this.now(),
    }

    await this.db.transaction('rw', this.db.questionAttempts, this.db.outbox, async () => {
      await this.db.questionAttempts.add(attempt)
      await this.enqueue('question_attempt', attempt.id, 'insert')
    })
    return attempt
  }

  async listAttempts(userId: string): Promise<QuestionAttempt[]> {
    return this.db.questionAttempts.where('userId').equals(userId).toArray()
  }

  // ── review state ─────────────────────────────────────────────────────────────

  async getReviewState(userId: string, itemId: string): Promise<ReviewState | null> {
    return (await this.db.reviewState.get([userId, itemId])) ?? null
  }

  async listReviewStates(userId: string): Promise<ReviewState[]> {
    return this.db.reviewState.where('userId').equals(userId).toArray()
  }

  async saveReviewState(state: ReviewState): Promise<void> {
    await this.db.transaction('rw', this.db.reviewState, this.db.outbox, async () => {
      await this.db.reviewState.put(state)
      await this.enqueue('review_state', compositeKey(state.userId, state.itemId), 'upsert')
    })
  }

  // ── personal notes ───────────────────────────────────────────────────────────

  async getPersonalNote(
    userId: string,
    lessonId: string,
    blockId: string,
  ): Promise<PersonalNote | null> {
    return (
      (await this.db.personalNotes
        .where('[userId+lessonId+blockId]')
        .equals([userId, lessonId, blockId])
        .first()) ?? null
    )
  }

  async listPersonalNotes(userId: string): Promise<PersonalNote[]> {
    return this.db.personalNotes.where('userId').equals(userId).toArray()
  }

  async savePersonalNote(
    userId: string,
    lessonId: string,
    blockId: string,
    note: string,
  ): Promise<PersonalNote> {
    const timestamp = this.now()
    let result: PersonalNote | null = null

    await this.db.transaction('rw', this.db.personalNotes, this.db.outbox, async () => {
      const existing = await this.db.personalNotes
        .where('[userId+lessonId+blockId]')
        .equals([userId, lessonId, blockId])
        .first()
      const next: PersonalNote = {
        id: existing?.id ?? newUuid(),
        userId,
        lessonId,
        blockId,
        note,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await this.db.personalNotes.put(next)
      await this.enqueue('personal_note', next.id, 'upsert')
      result = next
    })

    if (result === null) throw new Error('Uložení poznámky selhalo.')
    return result
  }

  // ── settings ─────────────────────────────────────────────────────────────────

  async getUserSettings(userId: string): Promise<UserSettings> {
    const existing = await this.db.userSettings.get(userId)
    if (existing !== undefined) return existing
    const timestamp = this.now()
    return {
      userId,
      preferredSessionMinutes: DEFAULT_USER_SETTINGS.preferredSessionMinutes,
      targetRetention: DEFAULT_USER_SETTINGS.targetRetention,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  async saveUserSettings(
    userId: string,
    patch: Partial<Pick<UserSettings, 'preferredSessionMinutes' | 'targetRetention'>>,
  ): Promise<UserSettings> {
    const current = await this.getUserSettings(userId)
    const next: UserSettings = { ...current, ...patch, updatedAt: this.now() }
    await this.db.transaction('rw', this.db.userSettings, this.db.outbox, async () => {
      await this.db.userSettings.put(next)
      await this.enqueue('user_settings', userId, 'upsert')
    })
    return next
  }

  // ── attempt drafts (local only) ──────────────────────────────────────────────

  async getAttemptDraft(userId: string, questionId: string): Promise<AttemptDraft | null> {
    return (await this.db.attemptDrafts.get(compositeKey(userId, questionId))) ?? null
  }

  async saveAttemptDraft(draft: AttemptDraft): Promise<void> {
    await this.db.attemptDrafts.put({ ...draft, updatedAt: this.now() })
  }

  async deleteAttemptDraft(userId: string, questionId: string): Promise<void> {
    await this.db.attemptDrafts.delete(compositeKey(userId, questionId))
  }

  // ── account lifecycle ────────────────────────────────────────────────────────

  /**
   * Re-owns data captured while signed out.
   *
   * Anything the learner did before logging in belongs to them; rather than discarding
   * it, every `local` row is rewritten under the real user ID and re-queued for sync.
   */
  async adoptLocalData(userId: string): Promise<number> {
    if (userId === LOCAL_USER_ID) return 0
    let moved = 0

    const progress = await this.db.lessonProgress.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const entry of progress) {
      await this.db.lessonProgress.delete([LOCAL_USER_ID, entry.lessonId])
      await this.updateLessonProgress(userId, entry.lessonId, {
        status: entry.status,
        currentBlockIndex: entry.currentBlockIndex,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        activeTimeMs: entry.activeTimeMs,
        lastOpenedAt: entry.lastOpenedAt,
      })
      moved += 1
    }

    const events = await this.db.learnerEvents.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const event of events) {
      await this.db.transaction('rw', this.db.learnerEvents, this.db.outbox, async () => {
        await this.db.learnerEvents.put({ ...event, userId })
        await this.enqueue('learner_event', event.id, 'insert')
      })
      moved += 1
    }

    const attempts = await this.db.questionAttempts.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const attempt of attempts) {
      await this.db.transaction('rw', this.db.questionAttempts, this.db.outbox, async () => {
        await this.db.questionAttempts.put({ ...attempt, userId })
        await this.enqueue('question_attempt', attempt.id, 'insert')
      })
      moved += 1
    }

    const reviews = await this.db.reviewState.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const review of reviews) {
      await this.db.reviewState.delete([LOCAL_USER_ID, review.itemId])
      await this.saveReviewState({ ...review, userId })
      moved += 1
    }

    const notes = await this.db.personalNotes.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const note of notes) {
      await this.db.personalNotes.delete(note.id)
      await this.savePersonalNote(userId, note.lessonId, note.blockId, note.note)
      moved += 1
    }

    const drafts = await this.db.attemptDrafts.where('userId').equals(LOCAL_USER_ID).toArray()
    for (const draft of drafts) {
      await this.db.attemptDrafts.delete(draft.key)
      await this.db.attemptDrafts.put({
        ...draft,
        key: compositeKey(userId, draft.questionId),
        userId,
      })
    }

    return moved
  }

  /** Full learner export for the settings screen. */
  async exportUserData(userId: string): Promise<JsonObject> {
    const [progress, events, attempts, reviews, notes, settings, deviceId] = await Promise.all([
      this.listLessonProgress(userId),
      this.listEvents(userId),
      this.listAttempts(userId),
      this.listReviewStates(userId),
      this.listPersonalNotes(userId),
      this.getUserSettings(userId),
      this.getDeviceId(),
    ])

    return {
      exportedAt: this.now(),
      schemaVersion: 1,
      deviceId,
      userId,
      lessonProgress: progress as unknown as JsonObject[],
      learnerEvents: events as unknown as JsonObject[],
      questionAttempts: attempts as unknown as JsonObject[],
      reviewState: reviews as unknown as JsonObject[],
      personalNotes: notes as unknown as JsonObject[],
      userSettings: settings as unknown as JsonObject,
    }
  }

  /** Wipes local data. The device ID is regenerated on next use. */
  async clearLocalData(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.lessonProgress,
        this.db.learnerEvents,
        this.db.questionAttempts,
        this.db.reviewState,
        this.db.personalNotes,
        this.db.userSettings,
        this.db.attemptDrafts,
        this.db.outbox,
      ],
      async () => {
        await Promise.all([
          this.db.lessonProgress.clear(),
          this.db.learnerEvents.clear(),
          this.db.questionAttempts.clear(),
          this.db.reviewState.clear(),
          this.db.personalNotes.clear(),
          this.db.userSettings.clear(),
          this.db.attemptDrafts.clear(),
          this.db.outbox.clear(),
        ])
      },
    )
  }
}

let repository: LocalRepository | null = null

export function getLocalRepository(): LocalRepository {
  repository ??= new LocalRepository()
  return repository
}

/** Test hook. */
export function setLocalRepository(next: LocalRepository | null): void {
  repository = next
}
