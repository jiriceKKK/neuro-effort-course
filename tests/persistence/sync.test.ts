import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningDatabase } from '../../src/persistence/local/db'
import { LocalRepository } from '../../src/persistence/local/repository'
import { newUuid } from '../../src/persistence/local/ids'
import { SyncEngine } from '../../src/persistence/sync/syncEngine'
import type { RemoteRepository } from '../../src/persistence/remote/remoteRepository'
import type {
  LearnerEvent,
  LessonProgress,
  PersonalNote,
  QuestionAttempt,
  ReviewState,
  UserSettings,
} from '../../src/types/learner'

/**
 * In-memory stand-in for Supabase.
 *
 * It reproduces the two properties the real schema guarantees: append-only rows are
 * keyed by a client-generated UUID (so a repeat push is a no-op) and state rows upsert
 * on their natural key.
 */
class FakeRemote implements RemoteRepository {
  events = new Map<string, LearnerEvent>()
  attempts = new Map<string, QuestionAttempt>()
  progress = new Map<string, LessonProgress>()
  reviews = new Map<string, ReviewState>()
  notes = new Map<string, PersonalNote>()
  settings = new Map<string, UserSettings>()
  failNext = 0
  pushCount = 0

  private maybeFail(): void {
    this.pushCount += 1
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new Error('síťová chyba')
    }
  }

  async pushLearnerEvent(event: LearnerEvent): Promise<void> {
    this.maybeFail()
    if (!this.events.has(event.id)) this.events.set(event.id, event)
  }

  async pushQuestionAttempt(attempt: QuestionAttempt): Promise<void> {
    this.maybeFail()
    if (!this.attempts.has(attempt.id)) this.attempts.set(attempt.id, attempt)
  }

  async pushLessonProgress(progress: LessonProgress): Promise<void> {
    this.maybeFail()
    const key = `${progress.userId}:${progress.lessonId}`
    const existing = this.progress.get(key)
    // Last write wins by updatedAt, exactly like the database trigger.
    if (existing === undefined || existing.updatedAt <= progress.updatedAt) {
      this.progress.set(key, progress)
    }
  }

  async pushReviewState(state: ReviewState): Promise<void> {
    this.maybeFail()
    this.reviews.set(`${state.userId}:${state.itemId}`, state)
  }

  async pushPersonalNote(note: PersonalNote): Promise<void> {
    this.maybeFail()
    this.notes.set(`${note.userId}:${note.lessonId}:${note.blockId}`, note)
  }

  async pushUserSettings(settings: UserSettings): Promise<void> {
    this.maybeFail()
    this.settings.set(settings.userId, settings)
  }

  async deleteAllUserData(userId: string): Promise<void> {
    for (const map of [this.events, this.attempts, this.progress, this.reviews, this.notes]) {
      for (const [key, value] of map) {
        if ((value as { userId: string }).userId === userId) map.delete(key)
      }
    }
    this.settings.delete(userId)
  }
}

let db: LearningDatabase
let local: LocalRepository
let remote: FakeRemote
let online = true

function makeEngine(overrides: { maxAttempts?: number } = {}): SyncEngine {
  return new SyncEngine({
    local,
    getRemote: () => remote,
    getUserId: () => 'user-1',
    isOnline: () => online,
    baseDelayMs: 0,
    maxDelayMs: 0,
    ...overrides,
  })
}

beforeEach(async () => {
  db = new LearningDatabase(`sync-${newUuid()}`)
  await db.open()
  local = new LocalRepository(db)
  remote = new FakeRemote()
  online = true
})

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('offline behaviour', () => {
  it('queues writes locally and reports Offline without contacting the server', async () => {
    online = false
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started', lessonId: 'demo-rpe' })
    await local.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 1 })

    const engine = makeEngine()
    const outcome = await engine.sync()

    expect(outcome.pushed).toBe(0)
    expect(remote.pushCount).toBe(0)
    expect(engine.getState().status).toBe('offline')
    expect(await local.countUnsynced()).toBe(2)
  })

  it('flushes the queue once connectivity returns', async () => {
    online = false
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started', lessonId: 'demo-rpe' })
    await local.recordAttempt({
      userId: 'user-1',
      questionId: 'demo-rpe-q-signal',
      lessonId: 'demo-rpe',
      conceptIds: ['reward-prediction-error'],
      selectedOptionId: 'maly',
      correctness: 2,
      responseTimeMs: 2_000,
    })

    const engine = makeEngine()
    await engine.sync()
    online = true
    const outcome = await engine.sync()

    expect(outcome.pushed).toBe(2)
    expect(remote.events.size).toBe(1)
    expect(remote.attempts.size).toBe(1)
    expect(engine.getState().status).toBe('synced')
    expect(await local.countUnsynced()).toBe(0)
  })
})

describe('idempotency', () => {
  it('re-pushing the same rows creates no duplicates', async () => {
    const event = await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started' })
    await makeEngine().sync()

    // Simulate an ambiguous failure: the server got the row but the client never
    // learned that, so the entry is queued again.
    const entries = await db.outbox.toArray()
    await db.outbox.bulkPut(
      entries.map((entry) => ({ ...entry, status: 'pending' as const, attempts: 0 })),
    )
    await makeEngine().sync()

    expect(remote.events.size).toBe(1)
    expect(remote.events.get(event.id)?.eventType).toBe('lesson_started')
  })

  it('keeps the newest state row when an older write arrives late', async () => {
    await local.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 5 })
    await makeEngine().sync()
    const newest = remote.progress.get('user-1:demo-rpe')

    await remote.pushLessonProgress({
      ...newest!,
      currentBlockIndex: 1,
      updatedAt: '2020-01-01T00:00:00.000Z',
    })

    expect(remote.progress.get('user-1:demo-rpe')?.currentBlockIndex).toBe(5)
  })
})

describe('failure handling', () => {
  it('retries with backoff and never deletes unsynced local data', async () => {
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started', lessonId: 'demo-rpe' })
    remote.failNext = 1

    const engine = makeEngine()
    const failed = await engine.sync()

    expect(failed.failed).toBe(1)
    expect(engine.getState().status).toBe('error')
    expect(await local.listEvents('user-1')).toHaveLength(1)

    const outcome = await engine.sync()
    expect(outcome.pushed).toBe(1)
    expect(remote.events.size).toBe(1)
    expect(engine.getState().status).toBe('synced')
  })

  it('parks an entry as failed after the attempt budget and revives it on manual sync', async () => {
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started' })
    remote.failNext = 10

    const engine = makeEngine({ maxAttempts: 2 })
    await engine.sync()
    await engine.sync()

    const parked = await db.outbox.toArray()
    expect(parked[0]?.status).toBe('failed')
    expect(parked[0]?.lastError).toContain('síťová chyba')

    remote.failNext = 0
    const outcome = await engine.syncNow()
    expect(outcome.pushed).toBe(1)
  })

  it('retires an entry whose row is gone without calling the server', async () => {
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started' })
    await db.learnerEvents.clear()

    const outcome = await makeEngine().sync()
    expect(outcome.skipped).toBe(1)
    expect(remote.events.size).toBe(0)
  })
})

describe('status reporting', () => {
  it('notifies subscribers of every transition', async () => {
    const listener = vi.fn()
    const engine = makeEngine()
    engine.subscribe(listener)

    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started' })
    await engine.sync()

    const statuses = listener.mock.calls.map((call) => (call[0] as { status: string }).status)
    expect(statuses).toContain('syncing')
    expect(statuses.at(-1)).toBe('synced')
  })

  it('reports pending work without pushing', async () => {
    await local.appendEvent({ userId: 'user-1', eventType: 'lesson_started' })
    const engine = makeEngine()
    await engine.refreshStatus()

    expect(engine.getState().status).toBe('pending')
    expect(engine.getState().pendingCount).toBe(1)
    expect(remote.pushCount).toBe(0)
  })
})
