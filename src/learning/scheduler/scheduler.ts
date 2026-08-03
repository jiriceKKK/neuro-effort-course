import type { ReviewItemType, ReviewRating, ReviewState } from '../../types/learner'

/**
 * Transparent prototype review scheduler.
 *
 * This is deliberately *not* FSRS. Every number below is a stated rule a learner or
 * reviewer can check, which matters more at this stage than optimality. The state shape
 * already carries `difficulty`, `stability` and `retrievability` so that switching to a
 * real model later is a change of algorithm, not a migration.
 */

export const MAX_INTERVAL_DAYS = 60
export const MIN_INTERVAL_DAYS = 1
export const DAY_MS = 24 * 60 * 60 * 1000

/** First-review intervals, in days. */
export const FIRST_INTERVALS: Record<ReviewRating, number> = {
  fail: 1,
  hard: 1,
  good: 3,
  easy: 7,
}

/** Multipliers applied to the previous interval on a subsequent review. */
export const REPEAT_MULTIPLIERS: Record<ReviewRating, number> = {
  fail: 0, // reset to MIN_INTERVAL_DAYS
  hard: 1.2,
  good: 2,
  easy: 3,
}

const DIFFICULTY_DELTA: Record<ReviewRating, number> = {
  fail: 1,
  hard: 0.5,
  good: 0,
  easy: -0.5,
}

const DEFAULT_DIFFICULTY = 5

export interface ScheduleInput {
  previous: ReviewState | null
  rating: ReviewRating
  now: Date
  userId: string
  itemId: string
  itemType: ReviewItemType
  conceptId: string
}

export interface ScheduleResult {
  state: ReviewState
  /**
   * A failed item is shown again later in the same session before its 1-day interval
   * starts. The review screen re-queues it; the stored `dueAt` is unaffected.
   */
  repeatInSession: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Estimated recall probability at the moment of review, before the rating is applied. */
function estimateRetrievability(previous: ReviewState | null, now: Date): number {
  if (previous === null) return 1
  const elapsedDays = (now.getTime() - new Date(previous.updatedAt).getTime()) / DAY_MS
  const stability = Math.max(previous.stability, 0.1)
  return clamp(Math.exp(-Math.max(elapsedDays, 0) / stability), 0, 1)
}

export function nextIntervalDays(previous: ReviewState | null, rating: ReviewRating): number {
  if (previous === null || previous.reviewCount === 0) return FIRST_INTERVALS[rating]
  if (rating === 'fail') return MIN_INTERVAL_DAYS
  const interval = previous.intervalDays * REPEAT_MULTIPLIERS[rating]
  return clamp(Math.round(interval * 100) / 100, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)
}

export function scheduleReview(input: ScheduleInput): ScheduleResult {
  const { previous, rating, now } = input
  const intervalDays = clamp(
    nextIntervalDays(previous, rating),
    MIN_INTERVAL_DAYS,
    MAX_INTERVAL_DAYS,
  )
  const difficulty = clamp(
    (previous?.difficulty ?? DEFAULT_DIFFICULTY) + DIFFICULTY_DELTA[rating],
    1,
    10,
  )

  return {
    state: {
      userId: input.userId,
      itemId: input.itemId,
      itemType: input.itemType,
      conceptId: input.conceptId,
      dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
      lastResult: rating,
      intervalDays,
      difficulty,
      // Prototype proxy: stability equals the interval the learner just earned.
      stability: intervalDays,
      retrievability: estimateRetrievability(previous, now),
      reviewCount: (previous?.reviewCount ?? 0) + 1,
      lapseCount: (previous?.lapseCount ?? 0) + (rating === 'fail' ? 1 : 0),
      updatedAt: now.toISOString(),
    },
    repeatInSession: rating === 'fail',
  }
}

export function isDue(state: ReviewState, now: Date): boolean {
  return new Date(state.dueAt).getTime() <= now.getTime()
}

export function overdueDays(state: ReviewState, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(state.dueAt).getTime()) / DAY_MS)
}

/**
 * "Critically overdue" means the item has been waiting at least as long as its own
 * interval — i.e. roughly twice the time the schedule intended.
 */
export function isCriticallyOverdue(state: ReviewState, now: Date): boolean {
  return overdueDays(state, now) >= Math.max(1, state.intervalDays)
}

/** Due items, most urgent first. */
export function sortByUrgency(states: readonly ReviewState[], now: Date): ReviewState[] {
  return [...states]
    .filter((state) => isDue(state, now))
    .sort((a, b) => overdueDays(b, now) - overdueDays(a, now))
}

/** Czech formatting of the next review date, used under the rating buttons. */
export function formatDueDate(dueAt: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(dueAt),
  )
}
