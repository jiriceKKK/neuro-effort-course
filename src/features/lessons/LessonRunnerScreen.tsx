import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BlockRenderer } from '../../components/blocks/BlockRenderer'
import { BLOCK_TYPE_LABELS } from '../../components/blocks/blockLabels'
import { DemoBanner } from '../../components/DemoBanner'
import { useLessonRunner } from './useLessonRunner'
import {
  classifyAgainstEstimate,
  formatDuration,
  formatEstimate,
} from '../../learning/timing/activeTime'

/**
 * Runs one lesson.
 *
 * Progress and measured time are restored on reload, so closing the tab mid lesson and
 * coming back later resumes at the same block with the minutes already counted.
 */
export function LessonRunnerScreen(): ReactNode {
  const { lessonId = '' } = useParams<{ lessonId: string }>()
  const runner = useLessonRunner(lessonId)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [runner.currentIndex])

  if (runner.lesson === null) {
    return (
      <div className="card">
        <h1>Lekce nenalezena</h1>
        <p>Lekce „{lessonId}“ v tomto kurzu neexistuje.</p>
        <Link className="button lesson-card__link" to="/kurz">
          Zpět na mapu kurzu
        </Link>
      </div>
    )
  }

  if (runner.loading) {
    return (
      <p role="status" aria-live="polite">
        Načítám lekci…
      </p>
    )
  }

  const { lesson, currentIndex, activeTimeMs } = runner
  const block = lesson.blocks[currentIndex]
  const total = lesson.blocks.length
  const verdict = classifyAgainstEstimate(
    activeTimeMs,
    lesson.minimumReasonableActiveMinutes,
    lesson.maximumReasonableActiveMinutes,
  )

  if (runner.isCompleted) {
    return (
      <article>
        <h1>{lesson.title}</h1>
        <DemoBanner lesson={lesson} />

        <div className="card">
          <h2>Lekce dokončena</h2>
          <p className="preformatted">
            {`Odhad: ${formatEstimate(lesson.estimatedActiveMinutes)}\nSkutečný aktivní čas: ${formatDuration(activeTimeMs)}`}
          </p>
          <p className="meta-line">
            {verdict === 'within-range' &&
              'Váš čas odpovídá odhadu lekce. Odhad je zatím realistický.'}
            {verdict === 'below-range' &&
              'Prošli jste lekcí rychleji, než odhad předpokládá. Data se ukládají a slouží ke zpřesnění odhadů.'}
            {verdict === 'above-range' &&
              'Strávili jste v lekci víc času, než odhad předpokládá. Data se ukládají a slouží ke zpřesnění odhadů.'}
          </p>

          <h3>Cíle lekce</h3>
          <ul>
            {lesson.learningObjectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>

          <div className="cluster">
            <Link className="button lesson-card__link" to="/">
              Zpět na přehled
            </Link>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => runner.goToIndex(0)}
            >
              Projít lekci znovu
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article>
      <h1 ref={headingRef} tabIndex={-1}>
        {lesson.title}
      </h1>
      <DemoBanner lesson={lesson} />

      <div className="card card--flush">
        <p className="meta-line">
          Blok {currentIndex + 1} z {total}
          {block !== undefined && ` — ${BLOCK_TYPE_LABELS[block.type]}`}
        </p>
        <progress
          className="progress"
          value={currentIndex + 1}
          max={total}
          aria-label={`Postup lekcí: blok ${currentIndex + 1} z ${total}`}
        />
        <p className="meta-line">
          Odhad celé lekce: {formatEstimate(lesson.estimatedActiveMinutes)} · Váš aktivní čas:{' '}
          {formatDuration(activeTimeMs)}
        </p>
      </div>

      {block !== undefined && (
        <BlockRenderer
          key={block.id}
          block={block}
          lesson={lesson}
          api={runner.api}
          onContinue={runner.advance}
        />
      )}

      <nav aria-label="Navigace v lekci" className="cluster">
        <button
          type="button"
          className="button button--secondary"
          disabled={currentIndex === 0}
          onClick={() => runner.goToIndex(currentIndex - 1)}
        >
          Předchozí blok
        </button>
        <Link className="button button--ghost lesson-card__link" to="/kurz">
          Uložit a odejít
        </Link>
      </nav>
    </article>
  )
}
