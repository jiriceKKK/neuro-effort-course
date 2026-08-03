import courseData from './course.json'
import conceptsData from './concepts.json'
import sourcesData from './sources.json'
import {
  ContentValidationError,
  validateContentBundle,
  type RawContentBundle,
  type ValidatedContent,
} from './validation'
import type { Lesson, LessonBlock, Source } from './schema'

/**
 * The single entry point through which the application reads course content.
 *
 * React components must never import a lesson JSON file directly: content is validated
 * once, here, and every screen consumes the validated result. Lesson files are picked up
 * by glob, so adding `src/content/lessons/<id>.json` is enough to register a lesson.
 */

const lessonModules = import.meta.glob<unknown>('./lessons/*.json', {
  eager: true,
  import: 'default',
})

function buildBundle(): RawContentBundle {
  return {
    course: { file: 'src/content/course.json', data: courseData },
    concepts: { file: 'src/content/concepts.json', data: conceptsData },
    sources: { file: 'src/content/sources.json', data: sourcesData },
    lessons: Object.entries(lessonModules)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({ file: path.replace('./', 'src/content/'), data })),
  }
}

let cached: ValidatedContent | null = null
let cachedError: ContentValidationError | null = null

/**
 * Returns the validated content bundle.
 *
 * Throws `ContentValidationError` when content is invalid — invalid content is never
 * partially rendered. `src/app/App.tsx` turns the throw into a Czech content-error
 * screen in production and lets the full detail through in development.
 */
export function getContent(): ValidatedContent {
  if (cached !== null) return cached
  if (cachedError !== null) throw cachedError

  try {
    cached = validateContentBundle(buildBundle())
    return cached
  } catch (error) {
    if (error instanceof ContentValidationError) {
      cachedError = error
      if (import.meta.env.DEV) {
        console.error(error.message)
      }
    }
    throw error
  }
}

/** Test-only reset so a suite can re-run the loader with different data. */
export function resetContentCache(): void {
  cached = null
  cachedError = null
}

export function getLesson(lessonId: string): Lesson | null {
  return getContent().lessonsById.get(lessonId) ?? null
}

export function getLessonOrThrow(lessonId: string): Lesson {
  const lesson = getLesson(lessonId)
  if (lesson === null) throw new Error(`Lekce „${lessonId}“ neexistuje.`)
  return lesson
}

/** Resolves the citation objects for a block, skipping nothing silently. */
export function resolveSources(sourceIds: readonly string[]): Source[] {
  const { sourcesById } = getContent()
  return sourceIds.map((sourceId) => {
    const source = sourcesById.get(sourceId)
    if (source === undefined) throw new Error(`Zdroj „${sourceId}“ neexistuje.`)
    return source
  })
}

/** Czech-style short citation used under explanations and answer feedback. */
export function formatCitation(source: Source): string {
  const authors =
    source.authors.length > 2
      ? `${source.authors[0]} a kol.`
      : source.authors.join(' & ')
  const container = source.container === undefined ? '' : ` ${source.container}.`
  return `${authors} (${source.year}). ${source.title}.${container}`
}

export function findBlock(lesson: Lesson, blockId: string): LessonBlock | null {
  return lesson.blocks.find((block) => block.id === blockId) ?? null
}

/** Locates a review item by its question ID, which is unique across the whole course. */
export function findQuestionLocation(
  questionId: string,
): { lesson: Lesson; block: LessonBlock } | null {
  const entry = getContent().questions.find((candidate) => candidate.questionId === questionId)
  if (entry === undefined) return null
  const lesson = getLesson(entry.lessonId)
  if (lesson === null) return null
  const block = findBlock(lesson, entry.blockId)
  return block === null ? null : { lesson, block }
}

export { ContentValidationError }
