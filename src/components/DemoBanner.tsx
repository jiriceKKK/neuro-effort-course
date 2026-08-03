import type { ReactNode } from 'react'
import type { Lesson } from '../content/schema'

/**
 * Marks demo content.
 *
 * Content validation guarantees that a lesson with `status: 'demo'` carries the exact
 * approved wording, so this component only has to display it.
 */
export function DemoBanner({ lesson }: { lesson: Lesson }): ReactNode {
  if (lesson.status !== 'demo' || lesson.demoNotice === undefined) return null

  return (
    <div className="callout callout--demo" role="note">
      <p className="callout__title">Ukázkový obsah</p>
      <p style={{ marginBottom: 0 }}>{lesson.demoNotice}</p>
    </div>
  )
}
