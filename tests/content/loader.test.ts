import { describe, expect, it } from 'vitest'
import { findQuestionLocation, formatCitation, getContent, resolveSources } from '../../src/content/loader'
import { DEMO_NOTICE } from '../../src/content/schema'

/** Guards the real shipped content, not a fixture. */
describe('shipped course content', () => {
  const content = getContent()

  it('loads and validates both demo lessons', () => {
    expect(content.lessons.map((lesson) => lesson.id)).toEqual(['demo-evidence', 'demo-rpe'])
    for (const lesson of content.lessons) {
      expect(lesson.status).toBe('demo')
      expect(lesson.demoNotice).toBe(DEMO_NOTICE)
    }
  })

  it('keeps demo-rpe behind demo-evidence', () => {
    const rpe = content.lessonsById.get('demo-rpe')
    expect(rpe?.prerequisiteLessonIds).toEqual(['demo-evidence'])
  })

  it('gives every lesson a realistic, self-consistent time budget', () => {
    for (const lesson of content.lessons) {
      const total = lesson.blocks.reduce((sum, block) => sum + block.estimatedMinutes, 0)
      expect(total).toBeGreaterThanOrEqual(lesson.minimumReasonableActiveMinutes)
      expect(total).toBeLessThanOrEqual(lesson.maximumReasonableActiveMinutes)
    }
  })

  it('covers every required block type in the demo lessons', () => {
    const types = new Set(content.lessons.flatMap((lesson) => lesson.blocks.map((b) => b.type)))
    expect(types).toEqual(
      new Set([
        'explanation',
        'multiple_choice',
        'free_recall',
        'prediction',
        'scenario',
        'personal_transfer',
        'summary',
      ]),
    )
  })

  it('resolves every cited source and carries a DOI where one exists', () => {
    const allSourceIds = content.lessons.flatMap((lesson) => [
      ...lesson.sourceIds,
      ...lesson.blocks.flatMap((block) => block.sourceIds),
    ])
    expect(() => resolveSources(allSourceIds)).not.toThrow()

    const schultz = content.sourcesById.get('schultz-1997')
    expect(schultz?.doi).toBe('10.1126/science.275.5306.1593')
    expect(formatCitation(schultz!)).toContain('1997')
  })

  it('locates a review item from its question ID alone', () => {
    const location = findQuestionLocation('demo-rpe-q-signal')
    expect(location?.lesson.id).toBe('demo-rpe')
    expect(location?.block.id).toBe('otazka-signal')
  })
})
