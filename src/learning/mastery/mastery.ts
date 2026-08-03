import type { Lesson } from '../../content/schema'
import type { LessonProgress, QuestionAttempt, ReviewState } from '../../types/learner'
import { isCriticallyOverdue, isDue, sortByUrgency } from '../scheduler/scheduler'

/**
 * Aggregates learner state into the two things the dashboard needs: what the learner
 * knows, and what they should do next.
 *
 * Streaks are intentionally absent. The priority order rewards recovering overdue
 * material and finishing what is open, not consecutive-day pressure.
 */

export interface ConceptMastery {
  conceptId: string
  attempts: number
  /** Attempts scored as fully correct. */
  correct: number
  accuracy: number
  averageConfidence: number | null
  /**
   * Average confidence minus accuracy, both on 0–1. Positive means the learner was
   * more confident than their results justify.
   */
  calibrationGap: number | null
  lastAttemptAt: string | null
}

export function computeConceptMastery(attempts: readonly QuestionAttempt[]): ConceptMastery[] {
  const buckets = new Map<
    string,
    { attempts: number; correct: number; confidenceSum: number; confidenceCount: number; last: string | null }
  >()

  for (const attempt of attempts) {
    for (const conceptId of attempt.conceptIds) {
      const bucket = buckets.get(conceptId) ?? {
        attempts: 0,
        correct: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        last: null,
      }
      // Unevaluated attempts (free recall before self-rating) do not count either way.
      if (attempt.correctness !== null) {
        bucket.attempts += 1
        if (attempt.correctness === 2) bucket.correct += 1
      }
      if (attempt.confidence !== null) {
        bucket.confidenceSum += attempt.confidence
        bucket.confidenceCount += 1
      }
      if (bucket.last === null || attempt.createdAt > bucket.last) bucket.last = attempt.createdAt
      buckets.set(conceptId, bucket)
    }
  }

  return [...buckets.entries()]
    .map(([conceptId, bucket]) => {
      const accuracy = bucket.attempts === 0 ? 0 : bucket.correct / bucket.attempts
      const averageConfidence =
        bucket.confidenceCount === 0 ? null : bucket.confidenceSum / bucket.confidenceCount / 100
      return {
        conceptId,
        attempts: bucket.attempts,
        correct: bucket.correct,
        accuracy,
        averageConfidence,
        calibrationGap:
          averageConfidence === null || bucket.attempts === 0 ? null : averageConfidence - accuracy,
        lastAttemptAt: bucket.last,
      }
    })
    .sort((a, b) => a.accuracy - b.accuracy)
}

export type NextActionKind =
  | 'critical_review'
  | 'due_review'
  | 'continue_lesson'
  | 'start_lesson'
  | 'nothing_due'

export interface NextAction {
  kind: NextActionKind
  /** Czech call to action for the primary dashboard button. */
  label: string
  /** Czech one-line explanation of why this is next. */
  reason: string
  lessonId: string | null
  dueCount: number
}

export interface NextActionInput {
  reviewStates: readonly ReviewState[]
  progress: readonly LessonProgress[]
  lessons: readonly Lesson[]
  now: Date
}

/** True when every prerequisite lesson of `lesson` has been completed. */
export function prerequisitesMet(
  lesson: Lesson,
  progress: readonly LessonProgress[],
): boolean {
  if (lesson.prerequisiteLessonIds.length === 0) return true
  const completed = new Set(
    progress.filter((entry) => entry.status === 'completed').map((entry) => entry.lessonId),
  )
  return lesson.prerequisiteLessonIds.every((id) => completed.has(id))
}

/**
 * Dashboard priority, in the order required by the learning design:
 *   1. critically overdue review
 *   2. normal due review
 *   3. unfinished lesson
 *   4. new lesson whose prerequisites are met
 */
export function determineNextAction(input: NextActionInput): NextAction {
  const { reviewStates, progress, lessons, now } = input
  const due = sortByUrgency(reviewStates, now)
  const critical = due.filter((state) => isCriticallyOverdue(state, now))

  if (critical.length > 0) {
    return {
      kind: 'critical_review',
      label: 'Dohnat zameškané opakování',
      reason: `${formatCount(critical.length)} k opakování máte výrazně po termínu.`,
      lessonId: null,
      dueCount: due.length,
    }
  }

  if (due.length > 0) {
    return {
      kind: 'due_review',
      label: 'Začít opakování',
      reason: `Dnes je k opakování ${formatCount(due.length)}.`,
      lessonId: null,
      dueCount: due.length,
    }
  }

  const unfinished = progress
    .filter((entry) => entry.status === 'in_progress')
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0]
  if (unfinished !== undefined) {
    const lesson = lessons.find((entry) => entry.id === unfinished.lessonId)
    return {
      kind: 'continue_lesson',
      label: 'Pokračovat v lekci',
      reason:
        lesson === undefined
          ? 'Máte rozdělanou lekci.'
          : `Máte rozdělanou lekci „${lesson.title}“.`,
      lessonId: unfinished.lessonId,
      dueCount: 0,
    }
  }

  const startedIds = new Set(progress.map((entry) => entry.lessonId))
  const nextLesson = lessons.find(
    (lesson) => !startedIds.has(lesson.id) && prerequisitesMet(lesson, progress),
  )
  if (nextLesson !== undefined) {
    return {
      kind: 'start_lesson',
      label: 'Začít novou lekci',
      reason: `Následuje lekce „${nextLesson.title}“.`,
      lessonId: nextLesson.id,
      dueCount: 0,
    }
  }

  return {
    kind: 'nothing_due',
    label: 'Prohlédnout mapu kurzu',
    reason: 'Nic není po termínu a všechny dostupné lekce máte dokončené.',
    lessonId: null,
    dueCount: 0,
  }
}

/** Czech plural for review items: 1 položka / 2–4 položky / 5+ položek. */
export function formatCount(count: number): string {
  if (count === 1) return '1 položka'
  if (count >= 2 && count <= 4) return `${count} položky`
  return `${count} položek`
}

export function countDueReviews(reviewStates: readonly ReviewState[], now: Date): number {
  return reviewStates.filter((state) => isDue(state, now)).length
}
