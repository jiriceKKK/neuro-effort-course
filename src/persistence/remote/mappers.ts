import type {
  LearnerEvent,
  LessonProgress,
  PersonalNote,
  QuestionAttempt,
  ReviewState,
  UserSettings,
} from '../../types/learner'

/**
 * The single place where camelCase local state becomes snake_case Supabase rows.
 *
 * Keeping the mapping here means a column rename touches one file, and it keeps the
 * rest of the app free of database naming.
 */

export interface LessonProgressRow {
  user_id: string
  lesson_id: string
  status: string
  current_block_index: number
  started_at: string | null
  completed_at: string | null
  active_time_ms: number
  last_opened_at: string | null
  updated_at: string
}

export interface LearnerEventRow {
  id: string
  user_id: string
  device_id: string
  event_type: string
  lesson_id: string | null
  block_id: string | null
  concept_id: string | null
  question_id: string | null
  payload: unknown
  occurred_at: string
}

export interface QuestionAttemptRow {
  id: string
  user_id: string
  question_id: string
  lesson_id: string
  concept_ids: string[]
  selected_option_id: string | null
  free_response: string | null
  correctness: number | null
  confidence: number | null
  hint_used: boolean
  response_time_ms: number
  attempt_number: number
  created_at: string
}

export interface ReviewStateRow {
  user_id: string
  item_id: string
  item_type: string
  concept_id: string
  due_at: string
  last_result: string
  interval_days: number
  difficulty: number
  stability: number
  retrievability: number
  review_count: number
  lapse_count: number
  updated_at: string
}

/**
 * The local `id` is deliberately omitted: notes are upserted on their natural key
 * (user, lesson, block) so two devices that both create the note offline converge on a
 * single row instead of colliding on the unique constraint.
 */
export interface PersonalNoteRow {
  user_id: string
  lesson_id: string
  block_id: string
  note: string
  updated_at: string
}

export interface UserSettingsRow {
  user_id: string
  preferred_session_minutes: number
  target_retention: number
  updated_at: string
}

export function toLessonProgressRow(value: LessonProgress): LessonProgressRow {
  return {
    user_id: value.userId,
    lesson_id: value.lessonId,
    status: value.status,
    current_block_index: value.currentBlockIndex,
    started_at: value.startedAt,
    completed_at: value.completedAt,
    active_time_ms: value.activeTimeMs,
    last_opened_at: value.lastOpenedAt,
    updated_at: value.updatedAt,
  }
}

export function toLearnerEventRow(value: LearnerEvent): LearnerEventRow {
  return {
    id: value.id,
    user_id: value.userId,
    device_id: value.deviceId,
    event_type: value.eventType,
    lesson_id: value.lessonId,
    block_id: value.blockId,
    concept_id: value.conceptId,
    question_id: value.questionId,
    payload: value.payload,
    occurred_at: value.occurredAt,
  }
}

export function toQuestionAttemptRow(value: QuestionAttempt): QuestionAttemptRow {
  return {
    id: value.id,
    user_id: value.userId,
    question_id: value.questionId,
    lesson_id: value.lessonId,
    concept_ids: value.conceptIds,
    selected_option_id: value.selectedOptionId,
    free_response: value.freeResponse,
    correctness: value.correctness,
    confidence: value.confidence,
    hint_used: value.hintUsed,
    response_time_ms: value.responseTimeMs,
    attempt_number: value.attemptNumber,
    created_at: value.createdAt,
  }
}

export function toReviewStateRow(value: ReviewState): ReviewStateRow {
  return {
    user_id: value.userId,
    item_id: value.itemId,
    item_type: value.itemType,
    concept_id: value.conceptId,
    due_at: value.dueAt,
    last_result: value.lastResult,
    interval_days: value.intervalDays,
    difficulty: value.difficulty,
    stability: value.stability,
    retrievability: value.retrievability,
    review_count: value.reviewCount,
    lapse_count: value.lapseCount,
    updated_at: value.updatedAt,
  }
}

export function toPersonalNoteRow(value: PersonalNote): PersonalNoteRow {
  return {
    user_id: value.userId,
    lesson_id: value.lessonId,
    block_id: value.blockId,
    note: value.note,
    updated_at: value.updatedAt,
  }
}

export function toUserSettingsRow(value: UserSettings): UserSettingsRow {
  return {
    user_id: value.userId,
    preferred_session_minutes: value.preferredSessionMinutes,
    target_retention: value.targetRetention,
    updated_at: value.updatedAt,
  }
}
