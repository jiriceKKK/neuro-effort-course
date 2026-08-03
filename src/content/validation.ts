import type { z } from 'zod'
import {
  conceptsFileSchema,
  courseSchema,
  DEMO_NOTICE,
  lessonSchema,
  sourcesFileSchema,
  type Concept,
  type Course,
  type Lesson,
  type LessonBlock,
  type MultipleChoiceQuestion,
  type Source,
} from './schema'

/**
 * Environment-independent content validation.
 *
 * This module never touches the filesystem and never uses Vite-only APIs, so the exact
 * same rules run in three places: the browser loader, the Vitest suite, and the
 * `content:validate` CLI. Invalid content is never silently dropped — it always
 * produces an issue that names the file, the object, the field and the reason.
 */

export interface ContentIssue {
  /** Content file the problem lives in, e.g. `src/content/lessons/demo-rpe.json`. */
  file: string
  /** ID of the offending object (lesson, question, block…), when it can be determined. */
  objectId: string | null
  /** Dotted path to the invalid field, or `''` for whole-object problems. */
  field: string
  /** Czech explanation of what is wrong. */
  reason: string
}

export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[]

  constructor(issues: readonly ContentIssue[]) {
    super(
      `Obsah kurzu je neplatný (${issues.length} ${issues.length === 1 ? 'chyba' : 'chyb'}):\n` +
        issues.map(formatIssue).join('\n'),
    )
    this.name = 'ContentValidationError'
    this.issues = issues
  }
}

export function formatIssue(issue: ContentIssue): string {
  const object = issue.objectId === null ? '' : ` [${issue.objectId}]`
  const field = issue.field === '' ? '' : ` → ${issue.field}`
  return `  ${issue.file}${object}${field}: ${issue.reason}`
}

export interface RawContentFile {
  file: string
  data: unknown
}

export interface RawContentBundle {
  course: RawContentFile
  concepts: RawContentFile
  sources: RawContentFile
  lessons: RawContentFile[]
}

export interface QuestionIndexEntry {
  questionId: string
  lessonId: string
  blockId: string
  blockType: LessonBlock['type']
  /** Present only for blocks whose question is a multiple-choice item. */
  multipleChoice: MultipleChoiceQuestion | null
}

export interface ValidatedContent {
  course: Course
  concepts: Concept[]
  sources: Source[]
  /** Ordered by the module/lesson order declared in course.json. */
  lessons: Lesson[]
  conceptsById: ReadonlyMap<string, Concept>
  sourcesById: ReadonlyMap<string, Source>
  lessonsById: ReadonlyMap<string, Lesson>
  questions: QuestionIndexEntry[]
  /** Non-fatal remarks; surfaced by the CLI, ignored at runtime. */
  warnings: ContentIssue[]
}

function issuesFromZod(error: z.ZodError, file: string, objectId: string | null): ContentIssue[] {
  return error.issues.map((issue) => ({
    file,
    objectId,
    field: issue.path.join('.'),
    reason: issue.message,
  }))
}

function idOf(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && 'id' in data) {
    const { id } = data as { id: unknown }
    if (typeof id === 'string') return id
  }
  return null
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

/** Questions attached to a block, if that block type carries one. */
function questionOf(block: LessonBlock): { id: string; multipleChoice: MultipleChoiceQuestion | null } | null {
  switch (block.type) {
    case 'multiple_choice':
      return { id: block.question.id, multipleChoice: block.question }
    case 'scenario':
      return { id: block.question.id, multipleChoice: block.question }
    case 'free_recall':
      return { id: block.question.id, multipleChoice: null }
    case 'prediction':
      return { id: block.question.id, multipleChoice: null }
    case 'explanation':
    case 'personal_transfer':
    case 'summary':
      return null
  }
}

const RETRIEVAL_BLOCK_TYPES: ReadonlySet<LessonBlock['type']> = new Set([
  'multiple_choice',
  'free_recall',
  'prediction',
  'scenario',
])

export function validateContentBundle(bundle: RawContentBundle): ValidatedContent {
  const issues: ContentIssue[] = []
  const warnings: ContentIssue[] = []

  const courseResult = courseSchema.safeParse(bundle.course.data)
  const conceptsResult = conceptsFileSchema.safeParse(bundle.concepts.data)
  const sourcesResult = sourcesFileSchema.safeParse(bundle.sources.data)

  if (!courseResult.success) {
    issues.push(...issuesFromZod(courseResult.error, bundle.course.file, idOf(bundle.course.data)))
  }
  if (!conceptsResult.success) {
    issues.push(...issuesFromZod(conceptsResult.error, bundle.concepts.file, null))
  }
  if (!sourcesResult.success) {
    issues.push(...issuesFromZod(sourcesResult.error, bundle.sources.file, null))
  }

  const lessons: Lesson[] = []
  const lessonFiles = new Map<string, string>()
  for (const raw of bundle.lessons) {
    const result = lessonSchema.safeParse(raw.data)
    if (!result.success) {
      issues.push(...issuesFromZod(result.error, raw.file, idOf(raw.data)))
      continue
    }
    lessons.push(result.data)
    lessonFiles.set(result.data.id, raw.file)
  }

  // Structural parsing failed badly enough that cross-references cannot be checked.
  if (!courseResult.success || !conceptsResult.success || !sourcesResult.success) {
    throw new ContentValidationError(issues)
  }

  const course = courseResult.data
  const concepts = conceptsResult.data
  const sources = sourcesResult.data

  const fileOf = (lessonId: string): string => lessonFiles.get(lessonId) ?? 'src/content/lessons'

  for (const duplicate of findDuplicates(concepts.map((concept) => concept.id))) {
    issues.push({
      file: bundle.concepts.file,
      objectId: duplicate,
      field: 'id',
      reason: 'duplicitní ID konceptu',
    })
  }
  for (const duplicate of findDuplicates(sources.map((source) => source.id))) {
    issues.push({
      file: bundle.sources.file,
      objectId: duplicate,
      field: 'id',
      reason: 'duplicitní ID zdroje',
    })
  }
  for (const duplicate of findDuplicates(lessons.map((lesson) => lesson.id))) {
    issues.push({
      file: fileOf(duplicate),
      objectId: duplicate,
      field: 'id',
      reason: 'duplicitní ID lekce — každá lekce musí mít jedinečné ID',
    })
  }

  const conceptIds = new Set(concepts.map((concept) => concept.id))
  const sourceIds = new Set(sources.map((source) => source.id))
  const lessonIds = new Set(lessons.map((lesson) => lesson.id))

  // course.json ↔ lessons
  const referencedLessonIds = course.modules.flatMap((module) => module.lessonIds)
  for (const duplicate of findDuplicates(referencedLessonIds)) {
    issues.push({
      file: bundle.course.file,
      objectId: duplicate,
      field: 'modules[].lessonIds',
      reason: 'lekce je zařazena do kurzu více než jednou',
    })
  }
  for (const lessonId of referencedLessonIds) {
    if (!lessonIds.has(lessonId)) {
      issues.push({
        file: bundle.course.file,
        objectId: lessonId,
        field: 'modules[].lessonIds',
        reason: 'kurz odkazuje na lekci, která neexistuje',
      })
    }
  }
  for (const lesson of lessons) {
    if (!referencedLessonIds.includes(lesson.id)) {
      warnings.push({
        file: fileOf(lesson.id),
        objectId: lesson.id,
        field: 'id',
        reason: 'lekce není zařazena do žádného modulu v course.json a nezobrazí se v mapě kurzu',
      })
    }
  }

  const questions: QuestionIndexEntry[] = []
  const questionOwners = new Map<string, string>()

  for (const lesson of lessons) {
    const file = fileOf(lesson.id)

    for (const duplicate of findDuplicates(lesson.blocks.map((block) => block.id))) {
      issues.push({
        file,
        objectId: lesson.id,
        field: `blocks[id=${duplicate}]`,
        reason: 'duplicitní ID bloku v rámci lekce',
      })
    }

    for (const prerequisiteId of lesson.prerequisiteLessonIds) {
      if (!lessonIds.has(prerequisiteId)) {
        issues.push({
          file,
          objectId: lesson.id,
          field: 'prerequisiteLessonIds',
          reason: `předpokládaná lekce „${prerequisiteId}“ neexistuje`,
        })
      }
      if (prerequisiteId === lesson.id) {
        issues.push({
          file,
          objectId: lesson.id,
          field: 'prerequisiteLessonIds',
          reason: 'lekce nemůže být svým vlastním předpokladem',
        })
      }
    }

    for (const conceptId of lesson.conceptIds) {
      if (!conceptIds.has(conceptId)) {
        issues.push({
          file,
          objectId: lesson.id,
          field: 'conceptIds',
          reason: `koncept „${conceptId}“ není definován v concepts.json`,
        })
      }
    }
    for (const sourceId of lesson.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        issues.push({
          file,
          objectId: lesson.id,
          field: 'sourceIds',
          reason: `zdroj „${sourceId}“ není definován v sources.json`,
        })
      }
    }

    if (lesson.status === 'demo') {
      if (lesson.demoNotice !== DEMO_NOTICE) {
        issues.push({
          file,
          objectId: lesson.id,
          field: 'demoNotice',
          reason: `ukázková lekce musí být viditelně označena přesným textem: „${DEMO_NOTICE}“`,
        })
      }
    } else if (lesson.demoNotice !== undefined) {
      issues.push({
        file,
        objectId: lesson.id,
        field: 'demoNotice',
        reason: 'demoNotice smí mít pouze lekce se statusem „demo“',
      })
    }

    if ((lesson.status === 'reviewed' || lesson.status === 'published') && lesson.sourceIds.length === 0) {
      issues.push({
        file,
        objectId: lesson.id,
        field: 'sourceIds',
        reason: 'lekce se statusem „reviewed“ nebo „published“ musí uvádět alespoň jeden zdroj',
      })
    }

    if (!lesson.blocks.some((block) => RETRIEVAL_BLOCK_TYPES.has(block.type))) {
      issues.push({
        file,
        objectId: lesson.id,
        field: 'blocks',
        reason: 'lekce neobsahuje žádnou aktivitu na vybavování — samotný výklad nestačí',
      })
    }

    const blockMinutesTotal = lesson.blocks.reduce((sum, block) => sum + block.estimatedMinutes, 0)
    if (
      blockMinutesTotal < lesson.minimumReasonableActiveMinutes ||
      blockMinutesTotal > lesson.maximumReasonableActiveMinutes
    ) {
      issues.push({
        file,
        objectId: lesson.id,
        field: 'estimatedActiveMinutes',
        reason:
          `součet odhadů bloků je ${blockMinutesTotal} min, což je mimo rozsah ` +
          `${lesson.minimumReasonableActiveMinutes}–${lesson.maximumReasonableActiveMinutes} min deklarovaný lekcí`,
      })
    }

    for (const block of lesson.blocks) {
      for (const conceptId of block.conceptIds) {
        if (!conceptIds.has(conceptId)) {
          issues.push({
            file,
            objectId: `${lesson.id}/${block.id}`,
            field: 'conceptIds',
            reason: `koncept „${conceptId}“ není definován v concepts.json`,
          })
        }
      }
      for (const sourceId of block.sourceIds) {
        if (!sourceIds.has(sourceId)) {
          issues.push({
            file,
            objectId: `${lesson.id}/${block.id}`,
            field: 'sourceIds',
            reason: `zdroj „${sourceId}“ není definován v sources.json`,
          })
        }
      }

      if (
        block.type === 'explanation' &&
        block.sourceIds.length === 0 &&
        (lesson.status === 'reviewed' || lesson.status === 'published')
      ) {
        issues.push({
          file,
          objectId: `${lesson.id}/${block.id}`,
          field: 'sourceIds',
          reason: 'výkladový blok v auditované lekci musí mít citaci',
        })
      }

      const question = questionOf(block)
      if (question === null) continue

      const owner = questionOwners.get(question.id)
      if (owner !== undefined) {
        issues.push({
          file,
          objectId: question.id,
          field: 'question.id',
          reason: `duplicitní ID otázky — už je použito v „${owner}“`,
        })
      } else {
        questionOwners.set(question.id, `${lesson.id}/${block.id}`)
      }

      if (question.multipleChoice !== null) {
        const options = question.multipleChoice.options
        for (const duplicate of findDuplicates(options.map((option) => option.id))) {
          issues.push({
            file,
            objectId: question.id,
            field: 'question.options',
            reason: `duplicitní ID možnosti „${duplicate}“`,
          })
        }
        if (!options.some((option) => option.id === question.multipleChoice?.correctOptionId)) {
          issues.push({
            file,
            objectId: question.id,
            field: 'question.correctOptionId',
            reason: 'correctOptionId neodpovídá žádné z možností',
          })
        }
      }

      if (block.type === 'prediction') {
        for (const duplicate of findDuplicates(block.question.options.map((option) => option.id))) {
          issues.push({
            file,
            objectId: question.id,
            field: 'question.options',
            reason: `duplicitní ID možnosti „${duplicate}“`,
          })
        }
      }

      questions.push({
        questionId: question.id,
        lessonId: lesson.id,
        blockId: block.id,
        blockType: block.type,
        multipleChoice: question.multipleChoice,
      })
    }
  }

  if (issues.length > 0) throw new ContentValidationError(issues)

  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]))
  const orderedLessons = course.modules
    .flatMap((module) => module.lessonIds)
    .map((lessonId) => lessonsById.get(lessonId))
    .filter((lesson): lesson is Lesson => lesson !== undefined)
  for (const lesson of lessons) {
    if (!orderedLessons.includes(lesson)) orderedLessons.push(lesson)
  }

  return {
    course,
    concepts,
    sources,
    lessons: orderedLessons,
    conceptsById: new Map(concepts.map((concept) => [concept.id, concept])),
    sourcesById: new Map(sources.map((source) => [source.id, source])),
    lessonsById,
    questions,
    warnings,
  }
}
