import { describe, expect, it } from 'vitest'
import {
  ActiveTimeTracker,
  classifyAgainstEstimate,
  formatDuration,
  formatEstimate,
} from '../../src/learning/timing/activeTime'

/** Deterministic clock: tests advance time explicitly instead of waiting. */
function makeClock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance(ms: number) {
      value += ms
    },
  }
}

function makeTracker(idleTimeoutMs = 75_000, initialActiveTimeMs = 0) {
  const clock = makeClock()
  const wall = makeClock(Date.parse('2026-03-01T10:00:00.000Z'))
  const tracker = new ActiveTimeTracker({
    idleTimeoutMs,
    monotonic: clock.now,
    wallClock: wall.now,
    initialActiveTimeMs,
  })
  return { tracker, clock, wall }
}

describe('ActiveTimeTracker', () => {
  it('counts time while the learner keeps interacting', () => {
    const { tracker, clock } = makeTracker()
    tracker.start()

    for (let i = 0; i < 6; i += 1) {
      clock.advance(10_000)
      tracker.recordInteraction()
    }

    expect(tracker.getActiveTimeMs()).toBe(60_000)
  })

  it('stops counting after the idle timeout and resumes on the next interaction', () => {
    const { tracker, clock } = makeTracker(75_000)
    tracker.start()

    clock.advance(300_000) // five minutes without a single interaction
    expect(tracker.getActiveTimeMs()).toBe(75_000)

    tracker.recordInteraction()
    clock.advance(20_000)
    tracker.recordInteraction()
    expect(tracker.getActiveTimeMs()).toBe(95_000)
  })

  it('records idle time separately instead of discarding it', () => {
    const { tracker, clock } = makeTracker(75_000)
    tracker.start()
    clock.advance(200_000)

    const snapshot = tracker.getSnapshot()
    expect(snapshot.activeTimeMs).toBe(75_000)
    expect(snapshot.idleTimeMs).toBe(125_000)
  })

  it('excludes time while the tab is hidden', () => {
    const { tracker, clock } = makeTracker()
    tracker.start()

    clock.advance(10_000)
    tracker.recordInteraction()

    tracker.setHidden(true)
    clock.advance(600_000) // ten minutes in the background
    tracker.setHidden(false)

    tracker.recordInteraction()
    clock.advance(5_000)
    tracker.recordInteraction()

    expect(tracker.getActiveTimeMs()).toBe(15_000)
    expect(tracker.getSnapshot().idleTimeMs).toBe(600_000)
  })

  it('excludes time spent waiting on a long network request', () => {
    const { tracker, clock } = makeTracker()
    tracker.start()

    tracker.setNetworkWait(true)
    clock.advance(30_000)
    tracker.setNetworkWait(false)

    tracker.recordInteraction()
    clock.advance(4_000)
    tracker.recordInteraction()

    expect(tracker.getActiveTimeMs()).toBe(4_000)
  })

  it('resumes from time accumulated in an earlier session', () => {
    const { tracker, clock } = makeTracker(75_000, 120_000)
    tracker.start()
    clock.advance(10_000)
    tracker.recordInteraction()

    expect(tracker.getActiveTimeMs()).toBe(130_000)
  })

  it('freezes the total once the lesson is completed', () => {
    const { tracker, clock } = makeTracker()
    tracker.start()
    clock.advance(20_000)
    tracker.recordInteraction()
    tracker.complete()

    const total = tracker.getActiveTimeMs()
    clock.advance(600_000)
    expect(tracker.getActiveTimeMs()).toBe(total)
    expect(tracker.getSnapshot().completedAt).not.toBeNull()
  })

  it('records first and last interaction timestamps', () => {
    const { tracker, clock } = makeTracker()
    tracker.start()
    expect(tracker.getSnapshot().firstInteractionAt).toBeNull()

    clock.advance(5_000)
    tracker.recordInteraction()
    const snapshot = tracker.getSnapshot()
    expect(snapshot.firstInteractionAt).not.toBeNull()
    expect(snapshot.lastInteractionAt).toBe(snapshot.firstInteractionAt)
    expect(snapshot.openedAt).toBe('2026-03-01T10:00:00.000Z')
  })
})

describe('Czech time formatting', () => {
  it('formats measured durations', () => {
    expect(formatDuration(522_000)).toBe('8 min 42 s')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(3_900_000)).toBe('1 h 05 min')
  })

  it('formats estimates with correct Czech plurals', () => {
    expect(formatEstimate(1)).toBe('1 minuta')
    expect(formatEstimate(3)).toBe('3 minuty')
    expect(formatEstimate(10)).toBe('10 minut')
    expect(formatEstimate(1.5)).toBe('1,5 minuty')
  })
})

describe('classifyAgainstEstimate', () => {
  it('compares measured time against the declared range', () => {
    expect(classifyAgainstEstimate(9 * 60_000, 8, 10)).toBe('within-range')
    expect(classifyAgainstEstimate(4 * 60_000, 8, 10)).toBe('below-range')
    expect(classifyAgainstEstimate(20 * 60_000, 8, 10)).toBe('above-range')
  })
})
