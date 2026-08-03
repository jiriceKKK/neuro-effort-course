/**
 * Learner state — everything personal to one user.
 *
 * These shapes are the contract between IndexedDB, the sync outbox and the Supabase
 * tables created by `supabase/migrations/0001_initial_learning_schema.sql`. Field names
 * are camelCase locally and snake_case remotely; the mapping lives in
 * `src/persistence/remote/mappers.ts` and nowhere else.
 *
 * All timestamps are ISO-8601 strings in UTC.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** Identity used while nobody is signed in. Local rows are re-owned on login. */
export const LOCAL_USER_ID = 'local'

export type LessonStatus = 'not_started' | 'in_progress' | 'completed'

export interface LessonProgress {
  userId: string
  lessonId: string
  status: LessonStatus
  currentBlockIndex: number
  startedAt: string | null
  completedAt: string | null
  /** Measured active time, excluding hidden-tab and idle periods. */
  activeTimeMs: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}

export type LearnerEventType =
  | 'lesson_started'
  | 'block_opened'
  | 'answer_submitted'
  | 'answer_revealed'
  | 'confidence_recorded'
  | 'review_rated'
  | 'lesson_completed'
  | 'personal_transfer_saved'

/** Append-only. Never updated, never deleted by the application. */
export interface LearnerEvent {
  id: string
  userId: string
  deviceId: string
  eventType: LearnerEventType
  lessonId: string | null
  blockId: string | null
  conceptId: string | null
  questionId: string | null
  payload: JsonObject
  occurredAt: string
  createdAt: string
}

/** 0 = incorrect, 1 = partially correct, 2 = correct, null = not evaluated. */
export type Correctness = 0 | 1 | 2 | null

/** Append-only. A retry creates a new row with an incremented `attemptNumber`. */
export interface QuestionAttempt {
  id: string
  userId: string
  questionId: string
  lessonId: string
  conceptIds: string[]
  /** Always an option ID — never a letter and never an index. */
  selectedOptionId: string | null
  freeResponse: string | null
  correctness: Correctness
  /** Self-reported confidence, 0–100 %. */
  confidence: number | null
  hintUsed: boolean
  responseTimeMs: number
  attemptNumber: number
  createdAt: string
}

export type ReviewRating = 'fail' | 'hard' | 'good' | 'easy'
export type ReviewItemType = 'question' | 'concept'

export interface ReviewState {
  userId: string
  /** Stable review unit — a question or a concept, not a whole lesson. */
  itemId: string
  itemType: ReviewItemType
  conceptId: string
  dueAt: string
  lastResult: ReviewRating
  intervalDays: number
  /** Reserved for a later FSRS implementation; the prototype keeps them coherent. */
  difficulty: number
  stability: number
  retrievability: number
  reviewCount: number
  lapseCount: number
  updatedAt: string
}

export interface PersonalNote {
  id: string
  userId: string
  lessonId: string
  blockId: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface UserSettings {
  userId: string
  preferredSessionMinutes: number
  targetRetention: number
  createdAt: string
  updatedAt: string
}

export const DEFAULT_USER_SETTINGS = {
  preferredSessionMinutes: 30,
  targetRetention: 0.88,
} as const

/**
 * A multiple-choice or prediction attempt that has been started but not submitted.
 *
 * Local-only: this exists so a reload never reshuffles the options a learner is
 * currently looking at. It is deleted once the attempt is submitted.
 */
export interface AttemptDraft {
  /** `${userId}::${questionId}` */
  key: string
  userId: string
  lessonId: string
  blockId: string
  questionId: string
  /** Option IDs in the exact order shown to the learner. */
  optionOrder: string[]
  attemptNumber: number
  selectedOptionId: string | null
  confidence: number | null
  freeResponse: string | null
  /** Free-recall blocks reveal the model answer only after confidence is recorded. */
  revealed: boolean
  startedAt: string
  updatedAt: string
}

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'failed'

export type SyncEntityType =
  | 'learner_event'
  | 'question_attempt'
  | 'lesson_progress'
  | 'review_state'
  | 'personal_note'
  | 'user_settings'

export interface OutboxRecord {
  id: string
  entityType: SyncEntityType
  /** Local primary key of the row to push; the payload is read at push time. */
  entityKey: string
  /** Append-only rows insert; state rows upsert (last write wins on updatedAt). */
  operation: 'insert' | 'upsert'
  status: OutboxStatus
  attempts: number
  /** ISO timestamp before which the entry must not be retried. */
  nextAttemptAt: string
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type SyncStatus = 'synced' | 'offline' | 'pending' | 'syncing' | 'error'

/** Czech labels for the synchronisation indicator. */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  synced: 'Synchronizováno',
  offline: 'Offline',
  pending: 'Čekající změny',
  syncing: 'Probíhá synchronizace',
  error: 'Chyba synchronizace',
}

/** Czech labels for the four self-rating buttons. */
export const REVIEW_RATING_LABELS: Record<ReviewRating, string> = {
  fail: 'Nezvládl jsem',
  hard: 'Těžké',
  good: 'Dobré',
  easy: 'Snadné',
}
