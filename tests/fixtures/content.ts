import { DEMO_NOTICE } from '../../src/content/schema'
import type { RawContentBundle } from '../../src/content/validation'

/**
 * Minimal but valid content bundle.
 *
 * Tests mutate a deep clone of this to produce exactly one defect at a time, which is
 * what makes the resulting assertions specific.
 */

export function validLessonJson(): Record<string, unknown> {
  return {
    id: 'test-lesson',
    version: 1,
    status: 'demo',
    title: 'Testovací lekce',
    summary: 'Krátká testovací lekce.',
    estimatedActiveMinutes: 3,
    minimumReasonableActiveMinutes: 2,
    maximumReasonableActiveMinutes: 4,
    prerequisiteLessonIds: [],
    conceptIds: ['test-concept'],
    learningObjectives: ['Ověřit validaci obsahu.'],
    sourceIds: ['test-source'],
    demoNotice: DEMO_NOTICE,
    blocks: [
      {
        id: 'vyklad',
        type: 'explanation',
        title: 'Výklad',
        estimatedMinutes: 1,
        conceptIds: ['test-concept'],
        sourceIds: ['test-source'],
        paragraphs: ['Testovací odstavec.'],
      },
      {
        id: 'otazka',
        type: 'multiple_choice',
        title: 'Otázka',
        estimatedMinutes: 2,
        conceptIds: ['test-concept'],
        sourceIds: [],
        question: {
          id: 'test-question',
          prompt: 'Která možnost je správná?',
          cognitiveLevel: 'discrimination',
          correctOptionId: 'a',
          explanation: 'Vysvětlení správné odpovědi.',
          options: [
            { id: 'a', text: 'První možnost o délce zhruba tolik.', feedback: 'Správně, protože tato možnost odpovídá zadání.' },
            { id: 'b', text: 'Druhá možnost o délce zhruba tolik.', feedback: 'Nesprávně, protože tato možnost mění význam.' },
            { id: 'c', text: 'Třetí možnost o délce zhruba tolik.', feedback: 'Nesprávně, protože tato možnost zaměňuje pojmy.' },
          ],
        },
      },
    ],
  }
}

export function validBundle(): RawContentBundle {
  return {
    course: {
      file: 'src/content/course.json',
      data: {
        id: 'test-course',
        title: 'Testovací kurz',
        subtitle: 'Podtitul',
        description: 'Popis testovacího kurzu.',
        language: 'cs',
        version: 1,
        modules: [
          {
            id: 'modul-1',
            title: 'Modul 1',
            description: 'Popis modulu.',
            lessonIds: ['test-lesson'],
          },
        ],
      },
    },
    concepts: {
      file: 'src/content/concepts.json',
      data: [
        {
          id: 'test-concept',
          name: 'Testovací koncept',
          shortDefinition: 'Definice testovacího konceptu.',
        },
      ],
    },
    sources: {
      file: 'src/content/sources.json',
      data: [
        {
          id: 'test-source',
          type: 'journal-article',
          authors: ['Autor, A.'],
          year: 2020,
          title: 'Testovací zdroj',
          container: 'Testovací časopis, 1(1), 1–10',
        },
      ],
    },
    lessons: [{ file: 'src/content/lessons/test-lesson.json', data: validLessonJson() }],
  }
}

/** Deep clone helper so a mutation in one test cannot leak into another. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
