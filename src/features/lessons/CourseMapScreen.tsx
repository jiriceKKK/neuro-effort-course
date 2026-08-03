import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getContent } from '../../content/loader'
import { useLearnerSnapshot } from '../../persistence/local/useLearnerSnapshot'
import { prerequisitesMet } from '../../learning/mastery/mastery'
import { formatDuration, formatEstimate } from '../../learning/timing/activeTime'
import { BLOCK_TYPE_LABELS } from '../../components/blocks/blockLabels'

/**
 * Course map.
 *
 * Rendered from `course.json` modules, so adding a batch of reviewed lessons is a
 * content change rather than a UI change.
 */
export function CourseMapScreen(): ReactNode {
  const { course, lessonsById } = getContent()
  const snapshot = useLearnerSnapshot()

  return (
    <article>
      <h1>Mapa kurzu</h1>
      <p>{course.description}</p>

      {course.modules.map((module) => (
        <section key={module.id} className="card">
          <h2>{module.title}</h2>
          <p>{module.description}</p>

          <ul className="lesson-list">
            {module.lessonIds.map((lessonId) => {
              const lesson = lessonsById.get(lessonId)
              if (lesson === undefined) return null
              const entry = snapshot.progress.find((item) => item.lessonId === lesson.id)
              const unlocked = prerequisitesMet(lesson, snapshot.progress)
              const blockTypes = [...new Set(lesson.blocks.map((block) => block.type))]

              return (
                <li key={lesson.id} className="card card--flush">
                  <h3 className="lesson-card__title">{lesson.title}</h3>
                  {lesson.status === 'demo' && (
                    <span className="badge badge--demo">Ukázková lekce</span>
                  )}
                  <p>{lesson.summary}</p>
                  <p className="meta-line">
                    Odhad: {formatEstimate(lesson.estimatedActiveMinutes)} · Rozsah{' '}
                    {lesson.minimumReasonableActiveMinutes}–{lesson.maximumReasonableActiveMinutes}{' '}
                    min · {lesson.blocks.length} bloků
                  </p>
                  <p className="meta-line">
                    Obsahuje: {blockTypes.map((type) => BLOCK_TYPE_LABELS[type]).join(', ')}
                  </p>
                  {entry !== undefined && (
                    <p className="meta-line">
                      {entry.status === 'completed' ? 'Dokončeno' : 'Rozpracováno'} · naměřený
                      aktivní čas {formatDuration(entry.activeTimeMs)}
                    </p>
                  )}

                  {unlocked ? (
                    <Link className="button lesson-card__link" to={`/lekce/${lesson.id}`}>
                      {entry === undefined ? 'Začít lekci' : 'Otevřít lekci'}
                    </Link>
                  ) : (
                    <p className="meta-line">
                      Nejprve dokončete:{' '}
                      {lesson.prerequisiteLessonIds
                        .map((id) => lessonsById.get(id)?.title ?? id)
                        .join(', ')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <p className="meta-line">
        Struktura počítá s dalšími moduly. Nové lekce se přidávají jako JSON soubory, bez
        zásahu do kódu obrazovek.
      </p>
    </article>
  )
}
