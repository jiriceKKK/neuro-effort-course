import { describe, expect, it } from 'vitest'
import { ContentValidationError, validateContentBundle } from '../../src/content/validation'
import { clone, validBundle, validLessonJson } from '../fixtures/content'

/** Narrow helper: run validation and return the issues it raised. */
function issuesFor(mutate: (bundle: ReturnType<typeof validBundle>) => void) {
  const bundle = clone(validBundle())
  mutate(bundle)
  try {
    validateContentBundle(bundle)
  } catch (error) {
    if (error instanceof ContentValidationError) return error.issues
    throw error
  }
  return null
}

describe('validateContentBundle', () => {
  it('accepts a valid bundle and indexes it', () => {
    const content = validateContentBundle(validBundle())

    expect(content.lessons).toHaveLength(1)
    expect(content.lessons[0]?.id).toBe('test-lesson')
    expect(content.questions.map((entry) => entry.questionId)).toEqual(['test-question'])
    expect(content.conceptsById.get('test-concept')?.name).toBe('Testovací koncept')
    expect(content.warnings).toHaveLength(0)
  })

  it('rejects structurally invalid lesson JSON with a precise field path', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      delete lesson.title
    })

    expect(issues).not.toBeNull()
    expect(issues?.some((issue) => issue.field === 'title')).toBe(true)
    expect(issues?.[0]?.file).toBe('src/content/lessons/test-lesson.json')
  })

  it('rejects an unknown key instead of silently ignoring it', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.estimatedMinutesTypo = 5
    })

    expect(issues?.some((issue) => issue.reason.toLowerCase().includes('unrecognized'))).toBe(true)
  })

  it('reports a missing source ID', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.sourceIds = ['neexistujici-zdroj']
    })

    expect(
      issues?.some(
        (issue) => issue.field === 'sourceIds' && issue.reason.includes('neexistujici-zdroj'),
      ),
    ).toBe(true)
  })

  it('reports a missing concept ID', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.conceptIds = ['neexistujici-koncept']
    })

    expect(
      issues?.some(
        (issue) => issue.field === 'conceptIds' && issue.reason.includes('neexistujici-koncept'),
      ),
    ).toBe(true)
  })

  it('reports a prerequisite lesson that does not exist', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.prerequisiteLessonIds = ['neexistujici-lekce']
    })

    expect(
      issues?.some(
        (issue) =>
          issue.field === 'prerequisiteLessonIds' && issue.reason.includes('neexistujici-lekce'),
      ),
    ).toBe(true)
  })

  it('reports a lesson that is its own prerequisite', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.prerequisiteLessonIds = ['test-lesson']
    })

    expect(issues?.some((issue) => issue.reason.includes('svým vlastním předpokladem'))).toBe(true)
  })

  it('reports duplicate lesson IDs', () => {
    const issues = issuesFor((bundle) => {
      const second = validLessonJson()
      second.blocks = (second.blocks as Array<Record<string, unknown>>).map((block) => {
        if (block.type !== 'multiple_choice') return block
        const question = block.question as Record<string, unknown>
        return { ...block, question: { ...question, id: 'test-question-2' } }
      })
      bundle.lessons.push({ file: 'src/content/lessons/duplicate.json', data: second })
    })

    expect(issues?.some((issue) => issue.reason.includes('duplicitní ID lekce'))).toBe(true)
  })

  it('reports duplicate question IDs across lessons', () => {
    const issues = issuesFor((bundle) => {
      const second = validLessonJson()
      second.id = 'test-lesson-2'
      bundle.lessons.push({ file: 'src/content/lessons/second.json', data: second })
      const course = bundle.course.data as { modules: Array<{ lessonIds: string[] }> }
      course.modules[0]?.lessonIds.push('test-lesson-2')
    })

    expect(issues?.some((issue) => issue.reason.includes('duplicitní ID otázky'))).toBe(true)
  })

  it('reports duplicate block IDs within one lesson', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as { blocks: Array<Record<string, unknown>> }
      const first = lesson.blocks[0]
      if (first !== undefined) lesson.blocks.push({ ...first })
    })

    expect(issues?.some((issue) => issue.reason.includes('duplicitní ID bloku'))).toBe(true)
  })

  it('reports an MCQ whose correctOptionId matches no option', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as { blocks: Array<Record<string, unknown>> }
      const block = lesson.blocks[1] as { question: Record<string, unknown> }
      block.question.correctOptionId = 'neexistujici-moznost'
    })

    expect(issues?.some((issue) => issue.reason.includes('correctOptionId'))).toBe(true)
  })

  it('requires demo lessons to carry the exact approved demo notice', () => {
    const withoutNotice = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      delete lesson.demoNotice
    })
    expect(withoutNotice?.some((issue) => issue.field === 'demoNotice')).toBe(true)

    const wrongNotice = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.demoNotice = 'Jiný text.'
    })
    expect(wrongNotice?.some((issue) => issue.field === 'demoNotice')).toBe(true)
  })

  it('requires reviewed lessons to cite sources and non-demo lessons to drop the notice', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.status = 'reviewed'
      lesson.sourceIds = []
    })

    expect(issues?.some((issue) => issue.field === 'sourceIds')).toBe(true)
    expect(issues?.some((issue) => issue.field === 'demoNotice')).toBe(true)
  })

  it('rejects inconsistent time ranges', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as Record<string, unknown>
      lesson.minimumReasonableActiveMinutes = 10
    })

    expect(issues?.some((issue) => issue.field.includes('minimumReasonableActiveMinutes'))).toBe(
      true,
    )
  })

  it('rejects a lesson whose block estimates fall outside its declared range', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as { blocks: Array<Record<string, unknown>> }
      const block = lesson.blocks[0]
      if (block !== undefined) block.estimatedMinutes = 30
    })

    expect(issues?.some((issue) => issue.reason.includes('mimo rozsah'))).toBe(true)
  })

  it('rejects a lesson that contains no retrieval activity', () => {
    const issues = issuesFor((bundle) => {
      const lesson = bundle.lessons[0]?.data as {
        blocks: Array<Record<string, unknown>>
        maximumReasonableActiveMinutes: number
        estimatedActiveMinutes: number
        minimumReasonableActiveMinutes: number
      }
      lesson.blocks = [lesson.blocks[0] as Record<string, unknown>]
      lesson.estimatedActiveMinutes = 1
      lesson.minimumReasonableActiveMinutes = 1
      lesson.maximumReasonableActiveMinutes = 1
    })

    expect(issues?.some((issue) => issue.reason.includes('vybavování'))).toBe(true)
  })

  it('warns about a lesson missing from every module without failing', () => {
    const bundle = clone(validBundle())
    const second = validLessonJson()
    second.id = 'orphan-lesson'
    const blocks = second.blocks as Array<Record<string, unknown>>
    const mcq = blocks[1] as { question: Record<string, unknown> }
    mcq.question.id = 'orphan-question'
    bundle.lessons.push({ file: 'src/content/lessons/orphan-lesson.json', data: second })

    const content = validateContentBundle(bundle)
    expect(content.warnings.some((warning) => warning.objectId === 'orphan-lesson')).toBe(true)
  })
})
