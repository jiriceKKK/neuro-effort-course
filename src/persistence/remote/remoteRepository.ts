import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  LearnerEvent,
  LessonProgress,
  PersonalNote,
  QuestionAttempt,
  ReviewState,
  UserSettings,
} from '../../types/learner'
import {
  toLearnerEventRow,
  toLessonProgressRow,
  toPersonalNoteRow,
  toQuestionAttemptRow,
  toReviewStateRow,
  toUserSettingsRow,
} from './mappers'

/**
 * Cloud persistence.
 *
 * The interface exists so tests can inject a fake and never touch a real project.
 * Idempotency is structural rather than best-effort:
 *  - append-only rows carry a client-generated UUID and are inserted with
 *    `ignoreDuplicates`, so re-pushing after a lost response is a no-op;
 *  - state rows upsert on their natural key, and the database trigger drops an incoming
 *    row whose `updated_at` is older than the stored one (last write wins).
 */
export interface RemoteRepository {
  pushLearnerEvent(event: LearnerEvent): Promise<void>
  pushQuestionAttempt(attempt: QuestionAttempt): Promise<void>
  pushLessonProgress(progress: LessonProgress): Promise<void>
  pushReviewState(state: ReviewState): Promise<void>
  pushPersonalNote(note: PersonalNote): Promise<void>
  pushUserSettings(settings: UserSettings): Promise<void>
  /** Deletes every row belonging to the signed-in user. Confirmed separately in the UI. */
  deleteAllUserData(userId: string): Promise<void>
}

export class RemoteSyncError extends Error {
  readonly table: string

  constructor(message: string, table: string) {
    super(message)
    this.name = 'RemoteSyncError'
    this.table = table
  }
}

export class SupabaseRemoteRepository implements RemoteRepository {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private async insertAppendOnly(table: string, row: object): Promise<void> {
    const { error } = await this.client.from(table).upsert(row, {
      onConflict: 'id',
      ignoreDuplicates: true,
    })
    if (error !== null) throw new RemoteSyncError(error.message, table)
  }

  private async upsertState(table: string, row: object, onConflict: string): Promise<void> {
    const { error } = await this.client.from(table).upsert(row, { onConflict })
    if (error !== null) throw new RemoteSyncError(error.message, table)
  }

  async pushLearnerEvent(event: LearnerEvent): Promise<void> {
    await this.insertAppendOnly('learner_events', toLearnerEventRow(event))
  }

  async pushQuestionAttempt(attempt: QuestionAttempt): Promise<void> {
    await this.insertAppendOnly('question_attempts', toQuestionAttemptRow(attempt))
  }

  async pushLessonProgress(progress: LessonProgress): Promise<void> {
    await this.upsertState('lesson_progress', toLessonProgressRow(progress), 'user_id,lesson_id')
  }

  async pushReviewState(state: ReviewState): Promise<void> {
    await this.upsertState('review_state', toReviewStateRow(state), 'user_id,item_id')
  }

  async pushPersonalNote(note: PersonalNote): Promise<void> {
    await this.upsertState(
      'personal_notes',
      toPersonalNoteRow(note),
      'user_id,lesson_id,block_id',
    )
  }

  async pushUserSettings(settings: UserSettings): Promise<void> {
    await this.upsertState('user_settings', toUserSettingsRow(settings), 'user_id')
  }

  async deleteAllUserData(userId: string): Promise<void> {
    const tables = [
      'learner_events',
      'question_attempts',
      'lesson_progress',
      'review_state',
      'personal_notes',
      'user_settings',
    ]
    for (const table of tables) {
      // RLS restricts this to the caller's own rows even without the explicit filter;
      // the filter is kept so the intent is visible at the call site.
      const { error } = await this.client.from(table).delete().eq('user_id', userId)
      if (error !== null) throw new RemoteSyncError(error.message, table)
    }
  }
}
