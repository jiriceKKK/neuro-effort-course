import Dexie, { type Table } from 'dexie'
import type {
  AttemptDraft,
  LearnerEvent,
  LessonProgress,
  OutboxRecord,
  PersonalNote,
  QuestionAttempt,
  ReviewState,
  UserSettings,
} from '../../types/learner'

/**
 * IndexedDB schema (via Dexie).
 *
 * Local-first: every learner write lands here first and is only then queued for
 * Supabase. The tables mirror the remote schema one-to-one, plus two local-only tables:
 * `attemptDrafts` (so a reload cannot reshuffle a half-answered question) and `outbox`
 * (the durable sync queue). `meta` holds the persistent device ID.
 */

export interface MetaRecord {
  key: string
  value: string
}

export const DATABASE_NAME = 'neuro-effort-course'

export class LearningDatabase extends Dexie {
  lessonProgress!: Table<LessonProgress, [string, string]>
  learnerEvents!: Table<LearnerEvent, string>
  questionAttempts!: Table<QuestionAttempt, string>
  reviewState!: Table<ReviewState, [string, string]>
  personalNotes!: Table<PersonalNote, string>
  userSettings!: Table<UserSettings, string>
  attemptDrafts!: Table<AttemptDraft, string>
  outbox!: Table<OutboxRecord, string>
  meta!: Table<MetaRecord, string>

  constructor(name: string = DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      lessonProgress: '[userId+lessonId], userId, status, updatedAt',
      learnerEvents: 'id, userId, lessonId, occurredAt',
      questionAttempts: 'id, userId, questionId, lessonId, createdAt',
      reviewState: '[userId+itemId], userId, dueAt, conceptId',
      personalNotes: 'id, [userId+lessonId+blockId], userId, updatedAt',
      userSettings: 'userId',
      attemptDrafts: 'key, userId, [userId+lessonId]',
      outbox: 'id, status, entityType, [entityType+entityKey], [status+nextAttemptAt]',
      meta: 'key',
    })
  }
}

let instance: LearningDatabase | null = null

export function getDatabase(): LearningDatabase {
  instance ??= new LearningDatabase()
  return instance
}

/** Test hook: swap in an isolated database (used with fake-indexeddb). */
export function setDatabase(database: LearningDatabase | null): void {
  instance = database
}
