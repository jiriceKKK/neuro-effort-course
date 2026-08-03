import { z } from 'zod'

/**
 * Runtime schema for the static course content shipped with the application.
 *
 * Everything here describes *content*, never learner state. Content lives in JSON so
 * that it can be reviewed, diffed and validated independently of the React code, and
 * so that adding lessons never requires touching a component.
 *
 * Objects are strict: an unknown key is a content bug (usually a typo), not something
 * to ignore silently.
 */

const nonEmptyString = z.string().trim().min(1, 'nesmí být prázdný řetězec')
const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ID musí být kebab-case (malá písmena, číslice, pomlčky)')

/** Content lifecycle. Only `reviewed` and `published` lessons are treated as vetted. */
export const contentStatusSchema = z.enum(['demo', 'draft', 'reviewed', 'published'])
export type ContentStatus = z.infer<typeof contentStatusSchema>

/**
 * Exact banner every demo lesson must carry, so that a learner can never mistake an
 * architecture demo for audited course material.
 */
export const DEMO_NOTICE =
  'Ukázková lekce pro ověření aplikace. Nejde ještě o finální odborně auditovanou verzi kurzu.'

export const sourceSchema = z.strictObject({
  id: idSchema,
  type: z.enum(['journal-article', 'book', 'chapter', 'preprint', 'report']),
  authors: z.array(nonEmptyString).min(1),
  year: z.number().int().min(1800).max(2100),
  title: nonEmptyString,
  container: nonEmptyString.optional(),
  doi: z
    .string()
    .regex(/^10\.\d{4,9}\/\S+$/, 'DOI musí mít tvar 10.xxxx/...')
    .optional(),
  url: z.url().optional(),
  /** Short Czech note explaining what the source does and does not support. */
  note: nonEmptyString.optional(),
})
export type Source = z.infer<typeof sourceSchema>

export const conceptSchema = z.strictObject({
  id: idSchema,
  name: nonEmptyString,
  shortDefinition: nonEmptyString,
  /** Frequent misunderstanding of this concept, reused when writing distractors. */
  commonMisconception: nonEmptyString.optional(),
})
export type Concept = z.infer<typeof conceptSchema>

/**
 * A multiple-choice option. The ID is the only thing ever stored in learner state —
 * never a letter and never an index, because options are reshuffled on every attempt.
 */
export const multipleChoiceOptionSchema = z.strictObject({
  id: idSchema,
  text: nonEmptyString,
  /** Shown after submission for this specific option, correct or not. */
  feedback: nonEmptyString,
})
export type MultipleChoiceOption = z.infer<typeof multipleChoiceOptionSchema>

/** What the question actually measures. Used to keep recognition items in the minority. */
export const cognitiveLevelSchema = z.enum(['recall', 'discrimination', 'mechanism', 'transfer'])
export type CognitiveLevel = z.infer<typeof cognitiveLevelSchema>

export const multipleChoiceQuestionSchema = z
  .strictObject({
    id: idSchema,
    prompt: nonEmptyString,
    options: z.array(multipleChoiceOptionSchema).min(3).max(5),
    correctOptionId: idSchema,
    explanation: nonEmptyString,
    cognitiveLevel: cognitiveLevelSchema,
    /** Negated stems ("Co NEplatí…") must be declared so the UI can emphasise the NE. */
    negative: z.boolean().default(false),
    /**
     * Escape hatch for the length-bias audit. Only set this when the correct option is
     * genuinely longer for a content reason, and explain that reason here.
     */
    lengthBiasJustification: nonEmptyString.optional(),
  })
  .refine((question) => question.options.some((option) => option.id === question.correctOptionId), {
    error: 'correctOptionId neodpovídá žádné z možností',
    path: ['correctOptionId'],
  })
export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>

export const freeRecallQuestionSchema = z.strictObject({
  id: idSchema,
  prompt: nonEmptyString,
  modelAnswer: nonEmptyString,
  /** Checklist the learner scores their own answer against before self-rating. */
  requiredElements: z.array(nonEmptyString).min(1),
  explanation: nonEmptyString.optional(),
})
export type FreeRecallQuestion = z.infer<typeof freeRecallQuestionSchema>

export const predictionQuestionSchema = z
  .strictObject({
    id: idSchema,
    prompt: nonEmptyString,
    options: z.array(multipleChoiceOptionSchema).min(2).max(5),
    /**
     * Predictions may be genuinely open. When a defensible answer exists it is marked,
     * but the point of the block is committing before the explanation, not scoring.
     */
    correctOptionId: idSchema.optional(),
    reveal: nonEmptyString,
  })
  .refine(
    (question) =>
      question.correctOptionId === undefined ||
      question.options.some((option) => option.id === question.correctOptionId),
    { error: 'correctOptionId neodpovídá žádné z možností', path: ['correctOptionId'] },
  )
export type PredictionQuestion = z.infer<typeof predictionQuestionSchema>

const blockBase = {
  id: idSchema,
  title: nonEmptyString,
  estimatedMinutes: z.number().positive().max(60),
  conceptIds: z.array(idSchema),
  sourceIds: z.array(idSchema),
}

export const explanationBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('explanation'),
  paragraphs: z.array(nonEmptyString).min(1),
  /** Rendered under the Czech heading „Klíčový princip“. */
  keyPrinciple: nonEmptyString.optional(),
  /** Rendered under the Czech heading „Pozor na omyl“. */
  commonMistake: nonEmptyString.optional(),
  /** Optional labelled rows for a simple, non-graphical schematic model. */
  model: z
    .strictObject({
      caption: nonEmptyString,
      rows: z
        .array(
          z.strictObject({
            situation: nonEmptyString,
            expectation: nonEmptyString,
            outcome: nonEmptyString,
            signal: nonEmptyString,
          }),
        )
        .min(2),
      /** Mandatory reminder that a teaching schema is not a neural implementation. */
      caveat: nonEmptyString,
    })
    .optional(),
})

export const multipleChoiceBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('multiple_choice'),
  question: multipleChoiceQuestionSchema,
})

export const freeRecallBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('free_recall'),
  question: freeRecallQuestionSchema,
})

export const predictionBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('prediction'),
  question: predictionQuestionSchema,
})

export const scenarioBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('scenario'),
  /** The new case the learner has to apply the concept to. */
  situation: nonEmptyString,
  question: multipleChoiceQuestionSchema,
})

export const personalTransferBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('personal_transfer'),
  prompt: nonEmptyString,
  guidance: z.array(nonEmptyString).min(1),
  placeholder: nonEmptyString,
  minimumCharacters: z.number().int().min(0).max(2000).default(0),
})

export const summaryBlockSchema = z.strictObject({
  ...blockBase,
  type: z.literal('summary'),
  mainMechanism: nonEmptyString,
  distinctions: z.array(nonEmptyString).min(1),
  commonMisconception: nonEmptyString,
  nextTopic: nonEmptyString,
})

/**
 * Adding a block type is a three-step change: schema variant here, renderer in
 * src/components/blocks/, entry in the renderer registry. Nothing else needs to know.
 * Planned next: sorting, matching, interactive_simulation, diagram,
 * confidence_calibration, delayed_review.
 */
export const lessonBlockSchema = z.discriminatedUnion('type', [
  explanationBlockSchema,
  multipleChoiceBlockSchema,
  freeRecallBlockSchema,
  predictionBlockSchema,
  scenarioBlockSchema,
  personalTransferBlockSchema,
  summaryBlockSchema,
])
export type LessonBlock = z.infer<typeof lessonBlockSchema>
export type LessonBlockType = LessonBlock['type']

export const lessonSchema = z
  .strictObject({
    id: idSchema,
    version: z.number().int().min(1),
    status: contentStatusSchema,
    title: nonEmptyString,
    summary: nonEmptyString,
    estimatedActiveMinutes: z.number().positive().max(180),
    minimumReasonableActiveMinutes: z.number().positive().max(180),
    maximumReasonableActiveMinutes: z.number().positive().max(180),
    prerequisiteLessonIds: z.array(idSchema),
    conceptIds: z.array(idSchema).min(1),
    learningObjectives: z.array(nonEmptyString).min(1),
    sourceIds: z.array(idSchema),
    /** Present exactly on demo lessons; the runner shows it before the first block. */
    demoNotice: nonEmptyString.optional(),
    blocks: z.array(lessonBlockSchema).min(1),
  })
  .refine(
    (lesson) => lesson.minimumReasonableActiveMinutes <= lesson.estimatedActiveMinutes,
    {
      error: 'minimumReasonableActiveMinutes musí být menší nebo rovno estimatedActiveMinutes',
      path: ['minimumReasonableActiveMinutes'],
    },
  )
  .refine((lesson) => lesson.estimatedActiveMinutes <= lesson.maximumReasonableActiveMinutes, {
    error: 'estimatedActiveMinutes musí být menší nebo rovno maximumReasonableActiveMinutes',
    path: ['maximumReasonableActiveMinutes'],
  })
export type Lesson = z.infer<typeof lessonSchema>

export const moduleSchema = z.strictObject({
  id: idSchema,
  title: nonEmptyString,
  description: nonEmptyString,
  lessonIds: z.array(idSchema).min(1),
})
export type CourseModule = z.infer<typeof moduleSchema>

export const courseSchema = z.strictObject({
  id: idSchema,
  title: nonEmptyString,
  subtitle: nonEmptyString,
  description: nonEmptyString,
  language: z.literal('cs'),
  version: z.number().int().min(1),
  modules: z.array(moduleSchema).min(1),
})
export type Course = z.infer<typeof courseSchema>

export const conceptsFileSchema = z.array(conceptSchema).min(1)
export const sourcesFileSchema = z.array(sourceSchema).min(1)

/** Every question kind that can be answered, in a single addressable union. */
export type AnyQuestion = MultipleChoiceQuestion | FreeRecallQuestion | PredictionQuestion
