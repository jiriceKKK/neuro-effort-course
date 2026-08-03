import { useCallback, useEffect, useState } from 'react'
import { getLocalRepository } from './repository'
import { useAuth } from '../../features/auth/AuthContext'
import {
  LOCAL_USER_ID,
  type LessonProgress,
  type PersonalNote,
  type QuestionAttempt,
  type ReviewState,
} from '../../types/learner'

/**
 * Reads the current learner's local state.
 *
 * Screens always render from IndexedDB, never from a network response — that is what
 * makes the dashboard, review queue and progress view work identically offline.
 *
 * The loaded data carries the identity it was loaded for, so `loading` can be derived
 * rather than toggled from inside an effect: stale data for a previous user is never
 * shown as if it were current.
 */
export interface LearnerSnapshot {
  loading: boolean
  userId: string
  progress: LessonProgress[]
  reviews: ReviewState[]
  attempts: QuestionAttempt[]
  notes: PersonalNote[]
  reload: () => void
}

interface LoadedData {
  userId: string
  revision: number
  progress: LessonProgress[]
  reviews: ReviewState[]
  attempts: QuestionAttempt[]
  notes: PersonalNote[]
}

const EMPTY: Omit<LoadedData, 'userId' | 'revision'> = {
  progress: [],
  reviews: [],
  attempts: [],
  notes: [],
}

export function useLearnerSnapshot(): LearnerSnapshot {
  const { user } = useAuth()
  const userId = user?.id ?? LOCAL_USER_ID
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<LoadedData | null>(null)

  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true
    const repository = getLocalRepository()

    void (async () => {
      const [progress, reviews, attempts, notes] = await Promise.all([
        repository.listLessonProgress(userId),
        repository.listReviewStates(userId),
        repository.listAttempts(userId),
        repository.listPersonalNotes(userId),
      ])
      if (active) setData({ userId, revision, progress, reviews, attempts, notes })
    })()

    return () => {
      active = false
    }
  }, [userId, revision])

  const fresh = data !== null && data.userId === userId && data.revision === revision
  const current = fresh ? data : null

  return {
    loading: !fresh,
    userId,
    progress: current?.progress ?? EMPTY.progress,
    reviews: current?.reviews ?? EMPTY.reviews,
    attempts: current?.attempts ?? EMPTY.attempts,
    notes: current?.notes ?? EMPTY.notes,
    reload,
  }
}
