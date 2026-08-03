/**
 * Active-time measurement.
 *
 * The point is honesty about lesson length: a four-minute quiz must never be reported
 * as a thirty-minute lesson. Time is counted only while the learner is plausibly
 * working, which means it stops when
 *   - the tab is hidden or the app is backgrounded (Page Visibility API),
 *   - no interaction has happened for `idleTimeoutMs` (default 75 s),
 *   - the app is blocked on a long network request.
 *
 * No artificial minimum timers, no fake waiting screens: this only measures.
 *
 * The clock is injectable so tests can drive it deterministically. `monotonic` should be
 * `performance.now()` in the browser, which is unaffected by wall-clock adjustments.
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 75_000

export interface ActiveTimeSnapshot {
  /** Wall-clock ISO timestamp the block/lesson was opened. */
  openedAt: string
  firstInteractionAt: string | null
  lastInteractionAt: string | null
  activeTimeMs: number
  idleTimeMs: number
  completedAt: string | null
}

export interface ActiveTimeTrackerOptions {
  idleTimeoutMs?: number
  /** Monotonic milliseconds. Defaults to `performance.now()`. */
  monotonic?: () => number
  /** Wall clock milliseconds for timestamps. Defaults to `Date.now()`. */
  wallClock?: () => number
  /** Time already accumulated in previous sessions of the same lesson. */
  initialActiveTimeMs?: number
}

type PauseReason = 'hidden' | 'network' | 'stopped'

export class ActiveTimeTracker {
  private readonly idleTimeoutMs: number
  private readonly monotonic: () => number
  private readonly wallClock: () => number

  private running = false
  private readonly pauseReasons = new Set<PauseReason>()

  private openedAtWall = 0
  private lastAccrualAt = 0
  private lastInteractionAt = 0
  private firstInteractionAtWall: number | null = null
  private lastInteractionAtWall: number | null = null
  private completedAtWall: number | null = null

  private activeTimeMs: number
  private idleTimeMs = 0

  constructor(options: ActiveTimeTrackerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.monotonic = options.monotonic ?? (() => performance.now())
    this.wallClock = options.wallClock ?? (() => Date.now())
    this.activeTimeMs = options.initialActiveTimeMs ?? 0
  }

  /** Begins measuring. Opening counts as the first tick of activity, not as an interaction. */
  start(): void {
    if (this.running) return
    const now = this.monotonic()
    this.running = true
    this.openedAtWall = this.wallClock()
    this.lastAccrualAt = now
    this.lastInteractionAt = now
    this.pauseReasons.delete('stopped')
  }

  /**
   * Records a genuine learner interaction (click, keypress, scroll, answer submission).
   * This is what keeps the idle timer from expiring.
   */
  recordInteraction(): void {
    if (!this.running) return
    const now = this.monotonic()
    this.accrue(now)
    this.lastInteractionAt = now
    const wall = this.wallClock()
    this.firstInteractionAtWall ??= wall
    this.lastInteractionAtWall = wall
  }

  /** Page Visibility integration: hidden time is never active time. */
  setHidden(hidden: boolean): void {
    this.setPaused('hidden', hidden)
  }

  /** Suspends counting while the app waits on a slow network round trip. */
  setNetworkWait(waiting: boolean): void {
    this.setPaused('network', waiting)
  }

  private setPaused(reason: PauseReason, paused: boolean): void {
    if (this.running) this.accrue(this.monotonic())
    if (paused) this.pauseReasons.add(reason)
    else this.pauseReasons.delete(reason)
  }

  /** Stops measuring; time already accrued is kept. */
  stop(): void {
    if (!this.running) return
    this.accrue(this.monotonic())
    this.running = false
  }

  /** Marks the lesson finished and stops the clock. */
  complete(): void {
    this.stop()
    this.completedAtWall = this.wallClock()
  }

  get isPaused(): boolean {
    return this.pauseReasons.size > 0
  }

  /**
   * Splits elapsed time since the last accrual into active and idle parts.
   *
   * While paused, everything is idle. Otherwise, time counts as active only up to
   * `idleTimeoutMs` after the most recent interaction; the rest is idle.
   */
  private accrue(now: number): void {
    if (!this.running) {
      this.lastAccrualAt = now
      return
    }
    const delta = now - this.lastAccrualAt
    if (delta <= 0) {
      this.lastAccrualAt = now
      return
    }

    if (this.isPaused) {
      this.idleTimeMs += delta
    } else {
      const activeUntil = this.lastInteractionAt + this.idleTimeoutMs
      const activeEnd = Math.min(now, activeUntil)
      const active = Math.max(0, activeEnd - this.lastAccrualAt)
      this.activeTimeMs += active
      this.idleTimeMs += delta - active
    }
    this.lastAccrualAt = now
  }

  getActiveTimeMs(): number {
    if (this.running) this.accrue(this.monotonic())
    return Math.round(this.activeTimeMs)
  }

  getSnapshot(): ActiveTimeSnapshot {
    if (this.running) this.accrue(this.monotonic())
    return {
      openedAt: new Date(this.openedAtWall).toISOString(),
      firstInteractionAt:
        this.firstInteractionAtWall === null
          ? null
          : new Date(this.firstInteractionAtWall).toISOString(),
      lastInteractionAt:
        this.lastInteractionAtWall === null
          ? null
          : new Date(this.lastInteractionAtWall).toISOString(),
      activeTimeMs: Math.round(this.activeTimeMs),
      idleTimeMs: Math.round(this.idleTimeMs),
      completedAt:
        this.completedAtWall === null ? null : new Date(this.completedAtWall).toISOString(),
    }
  }
}

/** Czech duration formatting: „8 min 42 s“, „45 s“, „1 h 05 min“. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`
  if (minutes > 0) return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`
  return `${seconds} s`
}

/** Czech estimate formatting used before a lesson starts: „Odhad: 10 minut“. */
export function formatEstimate(minutes: number): string {
  const rounded = Math.round(minutes * 10) / 10
  if (Number.isInteger(rounded)) {
    const value = Math.trunc(rounded)
    if (value === 1) return '1 minuta'
    if (value >= 2 && value <= 4) return `${value} minuty`
    return `${value} minut`
  }
  return `${rounded.toString().replace('.', ',')} minuty`
}

/**
 * Compares measured time against the lesson's declared range so that inaccurate
 * estimates can be audited later instead of quietly persisting.
 */
export type EstimateVerdict = 'below-range' | 'within-range' | 'above-range'

export function classifyAgainstEstimate(
  activeTimeMs: number,
  minimumMinutes: number,
  maximumMinutes: number,
): EstimateVerdict {
  const minutes = activeTimeMs / 60_000
  if (minutes < minimumMinutes) return 'below-range'
  if (minutes > maximumMinutes) return 'above-range'
  return 'within-range'
}
