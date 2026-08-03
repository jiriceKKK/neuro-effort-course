import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  MAX_INTERVAL_DAYS,
  isCriticallyOverdue,
  isDue,
  nextIntervalDays,
  scheduleReview,
  sortByUrgency,
} from '../../src/learning/scheduler/scheduler'
import type { ReviewRating, ReviewState } from '../../src/types/learner'

const NOW = new Date('2026-03-01T10:00:00.000Z')

function schedule(rating: ReviewRating, previous: ReviewState | null = null, now = NOW) {
  return scheduleReview({
    previous,
    rating,
    now,
    userId: 'user-1',
    itemId: 'demo-rpe-q-signal',
    itemType: 'question',
    conceptId: 'reward-prediction-error',
  })
}

function daysBetween(from: Date, isoDate: string): number {
  return Math.round((new Date(isoDate).getTime() - from.getTime()) / DAY_MS)
}

describe('first review', () => {
  it('uses the documented first intervals', () => {
    expect(daysBetween(NOW, schedule('fail').state.dueAt)).toBe(1)
    expect(daysBetween(NOW, schedule('hard').state.dueAt)).toBe(1)
    expect(daysBetween(NOW, schedule('good').state.dueAt)).toBe(3)
    expect(daysBetween(NOW, schedule('easy').state.dueAt)).toBe(7)
  })

  it('repeats a failed item later in the same session', () => {
    expect(schedule('fail').repeatInSession).toBe(true)
    expect(schedule('good').repeatInSession).toBe(false)
  })

  it('counts the review and the lapse', () => {
    const failed = schedule('fail').state
    expect(failed.reviewCount).toBe(1)
    expect(failed.lapseCount).toBe(1)
    expect(schedule('good').state.lapseCount).toBe(0)
  })
})

describe('subsequent reviews', () => {
  const previous = schedule('good').state // 3 days

  it('roughly doubles on Good and triples on Easy', () => {
    expect(nextIntervalDays(previous, 'good')).toBe(6)
    expect(nextIntervalDays(previous, 'easy')).toBe(9)
  })

  it('resets to one day on Fail', () => {
    expect(nextIntervalDays(previous, 'fail')).toBe(1)
    const failed = schedule('fail', previous).state
    expect(daysBetween(NOW, failed.dueAt)).toBe(1)
    expect(failed.lapseCount).toBe(1)
  })

  it('grows conservatively on Hard', () => {
    expect(nextIntervalDays(previous, 'hard')).toBeGreaterThan(previous.intervalDays)
    expect(nextIntervalDays(previous, 'hard')).toBeLessThan(previous.intervalDays * 2)
  })

  it('caps the prototype interval at 60 days', () => {
    let state = previous
    for (let i = 0; i < 12; i += 1) state = schedule('easy', state).state
    expect(state.intervalDays).toBe(MAX_INTERVAL_DAYS)
    expect(daysBetween(NOW, state.dueAt)).toBe(MAX_INTERVAL_DAYS)
  })

  it('moves difficulty in the expected direction', () => {
    expect(schedule('fail', previous).state.difficulty).toBeGreaterThan(previous.difficulty)
    expect(schedule('easy', previous).state.difficulty).toBeLessThan(previous.difficulty)
  })
})

describe('due and overdue', () => {
  const base = schedule('good').state

  it('treats an item as due once dueAt has passed', () => {
    expect(isDue(base, NOW)).toBe(false)
    expect(isDue(base, new Date(NOW.getTime() + 3 * DAY_MS))).toBe(true)
  })

  it('treats an item waiting longer than its own interval as critically overdue', () => {
    const slightlyLate = new Date(NOW.getTime() + 4 * DAY_MS)
    const veryLate = new Date(NOW.getTime() + 7 * DAY_MS)
    expect(isCriticallyOverdue(base, slightlyLate)).toBe(false)
    expect(isCriticallyOverdue(base, veryLate)).toBe(true)
  })

  it('sorts due items most overdue first and drops the not-yet-due', () => {
    const soon: ReviewState = { ...base, itemId: 'soon', dueAt: new Date(NOW.getTime() - DAY_MS).toISOString() }
    const late: ReviewState = { ...base, itemId: 'late', dueAt: new Date(NOW.getTime() - 9 * DAY_MS).toISOString() }
    const future: ReviewState = { ...base, itemId: 'future', dueAt: new Date(NOW.getTime() + DAY_MS).toISOString() }

    expect(sortByUrgency([soon, future, late], NOW).map((state) => state.itemId)).toEqual([
      'late',
      'soon',
    ])
  })
})
