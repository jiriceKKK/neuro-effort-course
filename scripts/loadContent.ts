import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RawContentBundle, RawContentFile } from '../src/content/validation'

/**
 * Filesystem loader for the Node-side CLIs.
 *
 * The browser reads content through `import.meta.glob`; the scripts read the same files
 * from disk. Both then hand the identical raw bundle to `validateContentBundle`, so the
 * CLI can never pass while the application fails.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CONTENT_DIR = resolve(REPO_ROOT, 'src/content')
export const LESSONS_DIR = resolve(CONTENT_DIR, 'lessons')

function readJson(absolutePath: string, relativePath: string): RawContentFile {
  try {
    return { file: relativePath, data: JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown }
  } catch (error) {
    throw new Error(
      `Soubor ${relativePath} se nepodařilo načíst jako JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
}

export function loadRawContentBundle(): RawContentBundle {
  const lessonFiles = readdirSync(LESSONS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()

  return {
    course: readJson(resolve(CONTENT_DIR, 'course.json'), 'src/content/course.json'),
    concepts: readJson(resolve(CONTENT_DIR, 'concepts.json'), 'src/content/concepts.json'),
    sources: readJson(resolve(CONTENT_DIR, 'sources.json'), 'src/content/sources.json'),
    lessons: lessonFiles.map((name) =>
      readJson(resolve(LESSONS_DIR, name), `src/content/lessons/${name}`),
    ),
  }
}
