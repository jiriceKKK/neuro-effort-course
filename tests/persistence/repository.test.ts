import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LearningDatabase } from '../../src/persistence/local/db'
import { LocalRepository } from '../../src/persistence/local/repository'
import { compositeKey, newUuid } from '../../src/persistence/local/ids'
import { LOCAL_USER_ID } from '../../src/types/learner'

let db: LearningDatabase
let repository: LocalRepository

beforeEach(async () => {
  db = new LearningDatabase(`test-${newUuid()}`)
  await db.open()
  repository = new LocalRepository(db)
})

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('lesson progress', () => {
  it('saves and resumes progress across sessions', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', {
      status: 'in_progress',
      currentBlockIndex: 3,
      activeTimeMs: 42_000,
      startedAt: '2026-03-01T10:00:00.000Z',
    })

    // A "reload" is a fresh repository over the same IndexedDB database.
    const resumed = await new LocalRepository(db).getLessonProgress('user-1', 'demo-rpe')
    expect(resumed?.currentBlockIndex).toBe(3)
    expect(resumed?.activeTimeMs).toBe(42_000)
    expect(resumed?.status).toBe('in_progress')
  })

  it('keeps untouched fields when patching', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', {
      currentBlockIndex: 2,
      activeTimeMs: 10_000,
    })
    await repository.updateLessonProgress('user-1', 'demo-rpe', { status: 'completed' })

    const progress = await repository.getLessonProgress('user-1', 'demo-rpe')
    expect(progress?.currentBlockIndex).toBe(2)
    expect(progress?.activeTimeMs).toBe(10_000)
    expect(progress?.status).toBe('completed')
  })

  it('isolates progress per user', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 5 })
    await repository.updateLessonProgress('user-2', 'demo-rpe', { currentBlockIndex: 1 })

    expect((await repository.listLessonProgress('user-1')).map((p) => p.currentBlockIndex)).toEqual([5])
    expect((await repository.listLessonProgress('user-2')).map((p) => p.currentBlockIndex)).toEqual([1])
  })
})

describe('append-only tables', () => {
  it('gives every event a unique ID and queues it exactly once', async () => {
    const first = await repository.appendEvent({ userId: 'user-1', eventType: 'lesson_started', lessonId: 'demo-rpe' })
    const second = await repository.appendEvent({ userId: 'user-1', eventType: 'block_opened', lessonId: 'demo-rpe' })

    expect(first.id).not.toBe(second.id)
    expect(first.deviceId).toBe(second.deviceId)
    expect(await db.outbox.count()).toBe(2)
  })

  it('increments the attempt number per question and user', async () => {
    const input = {
      userId: 'user-1',
      questionId: 'demo-rpe-q-signal',
      lessonId: 'demo-rpe',
      conceptIds: ['reward-prediction-error'],
      responseTimeMs: 1_000,
    }
    expect((await repository.recordAttempt(input)).attemptNumber).toBe(1)
    expect((await repository.recordAttempt(input)).attemptNumber).toBe(2)
    expect((await repository.recordAttempt({ ...input, userId: 'user-2' })).attemptNumber).toBe(1)
  })

  it('stores the selected option ID rather than a position', async () => {
    const attempt = await repository.recordAttempt({
      userId: 'user-1',
      questionId: 'demo-rpe-q-signal',
      lessonId: 'demo-rpe',
      conceptIds: ['reward-prediction-error'],
      selectedOptionId: 'maly',
      correctness: 2,
      confidence: 80,
      responseTimeMs: 4_500,
    })

    expect(attempt.selectedOptionId).toBe('maly')
    expect(attempt.correctness).toBe(2)
  })
})

describe('attempt drafts', () => {
  it('preserves the shuffled option order while an attempt is unfinished', async () => {
    const optionOrder = ['zaporny', 'maly', 'hodnota', 'velky']
    await repository.saveAttemptDraft({
      key: compositeKey('user-1', 'demo-rpe-q-signal'),
      userId: 'user-1',
      lessonId: 'demo-rpe',
      blockId: 'otazka-signal',
      questionId: 'demo-rpe-q-signal',
      optionOrder,
      attemptNumber: 1,
      selectedOptionId: 'maly',
      confidence: 60,
      freeResponse: null,
      revealed: false,
      startedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    })

    const reloaded = await new LocalRepository(db).getAttemptDraft('user-1', 'demo-rpe-q-signal')
    expect(reloaded?.optionOrder).toEqual(optionOrder)
    expect(reloaded?.selectedOptionId).toBe('maly')

    await repository.deleteAttemptDraft('user-1', 'demo-rpe-q-signal')
    expect(await repository.getAttemptDraft('user-1', 'demo-rpe-q-signal')).toBeNull()
  })

  it('does not queue drafts for synchronisation', async () => {
    await repository.saveAttemptDraft({
      key: compositeKey('user-1', 'q'),
      userId: 'user-1',
      lessonId: 'demo-rpe',
      blockId: 'b',
      questionId: 'q',
      optionOrder: ['a', 'b'],
      attemptNumber: 1,
      selectedOptionId: null,
      confidence: null,
      freeResponse: null,
      revealed: false,
      startedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    })

    expect(await db.outbox.count()).toBe(0)
  })
})

describe('outbox', () => {
  it('collapses repeated upserts of the same row into one pending entry', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 1 })
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 2 })
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 3 })

    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entityKey).toBe(compositeKey('user-1', 'demo-rpe'))
    expect(entries[0]?.operation).toBe('upsert')
  })

  it('never collapses append-only inserts', async () => {
    await repository.appendEvent({ userId: 'user-1', eventType: 'block_opened' })
    await repository.appendEvent({ userId: 'user-1', eventType: 'block_opened' })
    expect(await db.outbox.count()).toBe(2)
  })

  it('revives failed entries on demand and counts unsynced work', async () => {
    await repository.appendEvent({ userId: 'user-1', eventType: 'block_opened' })
    const [entry] = await db.outbox.toArray()
    await repository.markOutbox(entry!.id, { status: 'failed', attempts: 6 })

    expect(await repository.countUnsynced()).toBe(1)
    expect(await repository.listPendingOutbox()).toHaveLength(0)

    expect(await repository.retryFailed()).toBe(1)
    expect(await repository.listPendingOutbox()).toHaveLength(1)
  })

  it('respects the retry backoff window', async () => {
    await repository.appendEvent({ userId: 'user-1', eventType: 'block_opened' })
    const [entry] = await db.outbox.toArray()
    const future = new Date(Date.now() + 60_000).toISOString()
    await repository.markOutbox(entry!.id, { nextAttemptAt: future })

    expect(await repository.listPendingOutbox(new Date())).toHaveLength(0)
    expect(await repository.listPendingOutbox(new Date(Date.now() + 120_000))).toHaveLength(1)
  })
})

describe('account lifecycle', () => {
  it('re-owns work captured before login instead of discarding it', async () => {
    await repository.updateLessonProgress(LOCAL_USER_ID, 'demo-evidence', {
      status: 'in_progress',
      currentBlockIndex: 2,
      activeTimeMs: 30_000,
    })
    await repository.appendEvent({ userId: LOCAL_USER_ID, eventType: 'lesson_started', lessonId: 'demo-evidence' })
    await repository.recordAttempt({
      userId: LOCAL_USER_ID,
      questionId: 'demo-evidence-q-korelace',
      lessonId: 'demo-evidence',
      conceptIds: ['correlational-study'],
      selectedOptionId: 'vztah',
      correctness: 2,
      responseTimeMs: 3_000,
    })
    await repository.savePersonalNote(LOCAL_USER_ID, 'demo-evidence', 'prenos', 'Moje poznámka.')

    await repository.adoptLocalData('user-9')

    expect(await repository.listLessonProgress(LOCAL_USER_ID)).toHaveLength(0)
    const progress = await repository.getLessonProgress('user-9', 'demo-evidence')
    expect(progress?.activeTimeMs).toBe(30_000)
    expect(await repository.listEvents('user-9')).toHaveLength(1)
    expect(await repository.listAttempts('user-9')).toHaveLength(1)
    expect((await repository.getPersonalNote('user-9', 'demo-evidence', 'prenos'))?.note).toBe(
      'Moje poznámka.',
    )
  })

  it('exports every local table for the signed-in learner', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 1 })
    await repository.savePersonalNote('user-1', 'demo-rpe', 'prenos', 'Poznámka')

    const exported = await repository.exportUserData('user-1')
    expect(Object.keys(exported)).toEqual(
      expect.arrayContaining([
        'lessonProgress',
        'learnerEvents',
        'questionAttempts',
        'reviewState',
        'personalNotes',
        'userSettings',
        'deviceId',
      ]),
    )
  })

  it('clears local data on request', async () => {
    await repository.updateLessonProgress('user-1', 'demo-rpe', { currentBlockIndex: 1 })
    await repository.clearLocalData()

    expect(await repository.listLessonProgress('user-1')).toHaveLength(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('settings', () => {
  it('returns documented defaults and persists changes', async () => {
    const defaults = await repository.getUserSettings('user-1')
    expect(defaults.preferredSessionMinutes).toBe(30)
    expect(defaults.targetRetention).toBe(0.88)

    await repository.saveUserSettings('user-1', { preferredSessionMinutes: 45 })
    expect((await repository.getUserSettings('user-1')).preferredSessionMinutes).toBe(45)
  })
})
