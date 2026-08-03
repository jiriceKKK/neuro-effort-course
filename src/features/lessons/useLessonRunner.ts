import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lesson } from '../../content/schema'
import { getLesson } from '../../content/loader'
import { getLocalRepository } from '../../persistence/local/repository'
import { compositeKey } from '../../persistence/local/ids'
import { useSync } from '../../persistence/sync/syncContext'
import { useAuth } from '../auth/AuthContext'
import { ActiveTimeTracker } from '../../learning/timing/activeTime'
import { formatDueDate, scheduleReview } from '../../learning/scheduler/scheduler'
import { LOCAL_USER_ID, type LessonProgress, type ReviewRating } from '../../types/learner'
import type { BlockApi } from '../../components/blocks/blockApi'

/**
 * Lesson session state: progress, measured active time, and the persistence API the
 * block renderers use.
 *
 * Time is flushed to IndexedDB periodically and on unmount, so closing the tab mid
 * lesson keeps the minutes already worked.
 */

const FLUSH_INTERVAL_MS = 15_000

export interface LessonRunnerState {
  loading: boolean
  lesson: Lesson | null
  progress: LessonProgress | null
  currentIndex: number
  activeTimeMs: number
  isCompleted: boolean
  api: BlockApi
  goToIndex(index: number): void
  advance(): void
  completeLesson(): Promise<void>
}

export function useLessonRunner(lessonId: string): LessonRunnerState {
  const { user } = useAuth()
  const { notifyLocalChange } = useSync()
  const userId = user?.id ?? LOCAL_USER_ID
  const repository = useMemo(() => getLocalRepository(), [])

  const lesson = useMemo(() => getLesson(lessonId), [lessonId])
  /** ID of the lesson whose session has finished bootstrapping; drives `loading`. */
  const [bootstrappedId, setBootstrappedId] = useState<string | null>(null)
  const [progress, setProgress] = useState<LessonProgress | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [activeTimeMs, setActiveTimeMs] = useState(0)
  const trackerRef = useRef<ActiveTimeTracker | null>(null)
  const loading = lesson !== null && bootstrappedId !== lesson.id

  // ── session bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    if (lesson === null) return
    let active = true

    void (async () => {
      const existing = await repository.getLessonProgress(userId, lesson.id)
      if (!active) return

      const startedFresh = existing === null || existing.status === 'not_started'
      const next = await repository.updateLessonProgress(userId, lesson.id, {
        status: existing?.status === 'completed' ? 'completed' : 'in_progress',
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      })
      if (!active) return

      setProgress(next)
      setCurrentIndex(Math.min(next.currentBlockIndex, lesson.blocks.length - 1))
      setActiveTimeMs(next.activeTimeMs)

      const tracker = new ActiveTimeTracker({ initialActiveTimeMs: next.activeTimeMs })
      tracker.start()
      trackerRef.current = tracker

      if (startedFresh) {
        await repository.appendEvent({
          userId,
          eventType: 'lesson_started',
          lessonId: lesson.id,
          payload: { estimatedActiveMinutes: lesson.estimatedActiveMinutes },
        })
      }
      notifyLocalChange()
      setBootstrappedId(lesson.id)
    })()

    return () => {
      active = false
    }
  }, [lesson, repository, userId, notifyLocalChange])

  // ── active-time measurement ──────────────────────────────────────────────
  useEffect(() => {
    const tracker = trackerRef.current
    if (tracker === null || lesson === null) return

    const handleVisibility = (): void => tracker.setHidden(document.hidden)
    const handleInteraction = (): void => tracker.recordInteraction()

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pointerdown', handleInteraction, { passive: true })
    window.addEventListener('keydown', handleInteraction)
    window.addEventListener('scroll', handleInteraction, { passive: true })

    const flush = setInterval(() => {
      const measured = tracker.getActiveTimeMs()
      setActiveTimeMs(measured)
      void repository.updateLessonProgress(userId, lesson.id, { activeTimeMs: measured })
    }, FLUSH_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pointerdown', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
      window.removeEventListener('scroll', handleInteraction)
      clearInterval(flush)
      tracker.stop()
      void repository.updateLessonProgress(userId, lesson.id, {
        activeTimeMs: tracker.getActiveTimeMs(),
      })
    }
    // `bootstrappedId` is a dependency because the tracker only exists once the
    // bootstrap effect has created it.
  }, [bootstrappedId, lesson, repository, userId])

  const markInteraction = useCallback(() => {
    trackerRef.current?.recordInteraction()
  }, [])

  // ── persistence API handed to block renderers ────────────────────────────
  const api = useMemo<BlockApi>(
    () => ({
      userId,
      markInteraction,
      loadDraft: (questionId) => repository.getAttemptDraft(userId, questionId),
      saveDraft: async (draft) => {
        await repository.saveAttemptDraft({
          ...draft,
          key: compositeKey(userId, draft.questionId),
          userId,
          lessonId,
          updatedAt: new Date().toISOString(),
        })
      },
      clearDraft: (questionId) => repository.deleteAttemptDraft(userId, questionId),
      recordAttempt: async (input) => {
        await repository.recordAttempt({
          userId,
          lessonId,
          questionId: input.questionId,
          conceptIds: input.conceptIds,
          selectedOptionId: input.selectedOptionId ?? null,
          freeResponse: input.freeResponse ?? null,
          correctness: input.correctness ?? null,
          confidence: input.confidence ?? null,
          responseTimeMs: input.responseTimeMs,
        })
        notifyLocalChange()
      },
      recordEvent: async (eventType, details) => {
        await repository.appendEvent({
          userId,
          eventType,
          lessonId,
          blockId: details?.blockId ?? null,
          questionId: details?.questionId ?? null,
          conceptId: details?.conceptId ?? null,
          payload: details?.payload ?? {},
        })
        notifyLocalChange()
      },
      recordReview: async (itemId, conceptId, rating: ReviewRating) => {
        const previous = await repository.getReviewState(userId, itemId)
        const { state } = scheduleReview({
          previous,
          rating,
          now: new Date(),
          userId,
          itemId,
          itemType: 'question',
          conceptId,
        })
        await repository.saveReviewState(state)
        notifyLocalChange()
        return formatDueDate(state.dueAt)
      },
      loadNote: async (blockId) => (await repository.getPersonalNote(userId, lessonId, blockId))?.note ?? '',
      saveNote: async (blockId, text) => {
        await repository.savePersonalNote(userId, lessonId, blockId, text)
        notifyLocalChange()
      },
    }),
    [lessonId, markInteraction, notifyLocalChange, repository, userId],
  )

  const goToIndex = useCallback(
    (index: number) => {
      if (lesson === null) return
      const bounded = Math.max(0, Math.min(index, lesson.blocks.length - 1))
      setCurrentIndex(bounded)
      markInteraction()
      void (async () => {
        const next = await repository.updateLessonProgress(userId, lesson.id, {
          currentBlockIndex: bounded,
          activeTimeMs: trackerRef.current?.getActiveTimeMs() ?? activeTimeMs,
        })
        setProgress(next)
        const block = lesson.blocks[bounded]
        if (block !== undefined) {
          await repository.appendEvent({
            userId,
            eventType: 'block_opened',
            lessonId: lesson.id,
            blockId: block.id,
            payload: { index: bounded, type: block.type },
          })
        }
        notifyLocalChange()
      })()
    },
    [activeTimeMs, lesson, markInteraction, notifyLocalChange, repository, userId],
  )

  const completeLesson = useCallback(async () => {
    if (lesson === null) return
    const tracker = trackerRef.current
    tracker?.complete()
    const measured = tracker?.getActiveTimeMs() ?? activeTimeMs
    setActiveTimeMs(measured)

    const next = await repository.updateLessonProgress(userId, lesson.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      activeTimeMs: measured,
      currentBlockIndex: lesson.blocks.length - 1,
    })
    setProgress(next)
    await repository.appendEvent({
      userId,
      eventType: 'lesson_completed',
      lessonId: lesson.id,
      payload: {
        activeTimeMs: measured,
        estimatedActiveMinutes: lesson.estimatedActiveMinutes,
        minimumReasonableActiveMinutes: lesson.minimumReasonableActiveMinutes,
        maximumReasonableActiveMinutes: lesson.maximumReasonableActiveMinutes,
      },
    })
    notifyLocalChange()
  }, [activeTimeMs, lesson, notifyLocalChange, repository, userId])

  const advance = useCallback(() => {
    if (lesson === null) return
    if (currentIndex >= lesson.blocks.length - 1) {
      void completeLesson()
      return
    }
    goToIndex(currentIndex + 1)
  }, [completeLesson, currentIndex, goToIndex, lesson])

  return {
    loading,
    lesson,
    progress,
    currentIndex,
    activeTimeMs,
    isCompleted: progress?.status === 'completed',
    api,
    goToIndex,
    advance,
    completeLesson,
  }
}
