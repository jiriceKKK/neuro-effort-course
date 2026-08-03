import type { Lesson, LessonBlock } from '../../content/schema'
import type { AttemptDraft, Correctness, LearnerEventType, ReviewRating } from '../../types/learner'
import type { JsonObject } from '../../types/learner'

/**
 * The seam between the lesson runner and the block renderers.
 *
 * Renderers own presentation and interaction; the runner owns persistence, timing and
 * scheduling. Adding a block type therefore never means touching persistence code.
 */
export interface BlockApi {
  userId: string
  markInteraction(): void
  loadDraft(questionId: string): Promise<AttemptDraft | null>
  /** `key`, `userId`, `lessonId` and `updatedAt` are filled in by the runner. */
  saveDraft(draft: Omit<AttemptDraft, 'key' | 'userId' | 'lessonId' | 'updatedAt'>): Promise<void>
  clearDraft(questionId: string): Promise<void>
  recordAttempt(input: {
    questionId: string
    conceptIds: string[]
    selectedOptionId?: string | null
    freeResponse?: string | null
    correctness?: Correctness
    confidence?: number | null
    responseTimeMs: number
  }): Promise<void>
  recordEvent(
    eventType: LearnerEventType,
    details?: { blockId?: string; questionId?: string; conceptId?: string; payload?: JsonObject },
  ): Promise<void>
  /** Schedules the item and returns the Czech-formatted next review date. */
  recordReview(itemId: string, conceptId: string, rating: ReviewRating): Promise<string>
  loadNote(blockId: string): Promise<string>
  saveNote(blockId: string, text: string): Promise<void>
}

export interface BlockViewProps<TBlock extends LessonBlock = LessonBlock> {
  block: TBlock
  lesson: Lesson
  api: BlockApi
  /** Advances the runner to the next block. */
  onContinue: () => void
}

/** Emphasises the negation in a negative stem so it cannot be skimmed past. */
export function renderNegation(prompt: string): Array<string | { negation: string }> {
  const parts: Array<string | { negation: string }> = []
  const pattern = /\bNE[A-ZÁ-Ž]*\b/g
  let lastIndex = 0
  let match = pattern.exec(prompt)
  while (match !== null) {
    if (match.index > lastIndex) parts.push(prompt.slice(lastIndex, match.index))
    parts.push({ negation: match[0] })
    lastIndex = match.index + match[0].length
    match = pattern.exec(prompt)
  }
  if (lastIndex < prompt.length) parts.push(prompt.slice(lastIndex))
  return parts
}
