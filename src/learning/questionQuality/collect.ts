import type { ValidatedContent } from '../../content/validation'
import type { AuditableQuestion } from './mcqBias'

/**
 * Collects every question that has a single designated correct option — the ones where
 * a surface cue could give the answer away.
 *
 * That covers `multiple_choice` and `scenario` blocks today, and automatically covers a
 * `prediction` block if an author ever marks a defensible answer on it. Predictions
 * without a correct option are excluded on purpose: they measure commitment, not
 * knowledge, so "the right answer looks different" cannot apply.
 */
export function collectAuditableQuestions(content: ValidatedContent): AuditableQuestion[] {
  const fileOf = (lessonId: string): string => `src/content/lessons/${lessonId}.json`

  return content.questions
    .filter((entry) => entry.multipleChoice !== null)
    .map((entry) => {
      const question = entry.multipleChoice
      if (question === null) throw new Error('unreachable: filtered above')
      return {
        id: question.id,
        prompt: question.prompt,
        options: question.options,
        correctOptionId: question.correctOptionId,
        negative: question.negative,
        lengthBiasJustification: question.lengthBiasJustification,
        cognitiveLevel: question.cognitiveLevel,
        lessonId: entry.lessonId,
        blockId: entry.blockId,
        file: fileOf(entry.lessonId),
      }
    })
}
