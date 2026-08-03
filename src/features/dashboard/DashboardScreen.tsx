import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getContent } from '../../content/loader'
import { useLearnerSnapshot } from '../../persistence/local/useLearnerSnapshot'
import { useSync } from '../../persistence/sync/syncContext'
import { SyncBadge } from '../../components/SyncBadge'
import { countDueReviews, determineNextAction, formatCount } from '../../learning/mastery/mastery'
import { formatDuration, formatEstimate } from '../../learning/timing/activeTime'

/**
 * Entry screen.
 *
 * The primary action follows the documented priority order — overdue review, due
 * review, unfinished lesson, new lesson — and there is deliberately no streak.
 */
export function DashboardScreen(): ReactNode {
  const { lessons, course } = getContent()
  const snapshot = useLearnerSnapshot()
  const { state: syncState } = useSync()
  const now = useMemo(() => new Date(), [])

  const dueCount = countDueReviews(snapshot.reviews, now)
  const nextAction = determineNextAction({
    reviewStates: snapshot.reviews,
    progress: snapshot.progress,
    lessons,
    now,
  })

  const totalActiveMs = snapshot.progress.reduce((sum, entry) => sum + entry.activeTimeMs, 0)
  const recentActiveMs = snapshot.progress
    .filter((entry) => {
      if (entry.lastOpenedAt === null) return false
      return now.getTime() - new Date(entry.lastOpenedAt).getTime() <= 7 * 24 * 60 * 60 * 1000
    })
    .reduce((sum, entry) => sum + entry.activeTimeMs, 0)

  const isOffline = syncState.status === 'offline'

  if (snapshot.loading) {
    return (
      <p role="status" aria-live="polite">
        Načítám váš postup…
      </p>
    )
  }

  return (
    <article>
      <h1>Přehled</h1>
      <p className="meta-line">{course.subtitle}</p>

      <div className="card">
        <div className="cluster" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ marginBottom: 0 }}>Co dělat teď</h2>
          <SyncBadge status={syncState.status} pendingCount={syncState.pendingCount} />
        </div>
        <p>{nextAction.reason}</p>
        {nextAction.lessonId !== null ? (
          <Link className="button lesson-card__link" to={`/lekce/${nextAction.lessonId}`}>
            {nextAction.label}
          </Link>
        ) : nextAction.kind === 'critical_review' || nextAction.kind === 'due_review' ? (
          <Link className="button lesson-card__link" to="/opakovani">
            {nextAction.label}
          </Link>
        ) : (
          <Link className="button lesson-card__link" to="/kurz">
            {nextAction.label}
          </Link>
        )}
        {isOffline && (
          <p className="meta-line">
            Jste offline. Lekce, které máte uložené, fungují dál a odpovědi se odešlou po
            obnovení připojení.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Opakování</h2>
        <p>
          {dueCount === 0
            ? 'Dnes nemáte nic k opakování.'
            : `K opakování je připraveno ${formatCount(dueCount)}.`}
        </p>
        <Link className="button button--secondary lesson-card__link" to="/opakovani">
          Otevřít opakování
        </Link>
      </div>

      <div className="card">
        <h2>Naměřený aktivní čas</h2>
        <dl className="definition-list">
          <dt>Za posledních 7 dní</dt>
          <dd>{formatDuration(recentActiveMs)}</dd>
          <dt>Celkem</dt>
          <dd>{formatDuration(totalActiveMs)}</dd>
        </dl>
        <p className="meta-line">
          Počítá se jen aktivní práce. Čas na skryté záložce a delší nečinnost se nezapočítávají.
        </p>
      </div>

      <h2>Ukázkové lekce</h2>
      <ul className="lesson-list">
        {lessons.map((lesson) => {
          const entry = snapshot.progress.find((item) => item.lessonId === lesson.id)
          return (
            <li key={lesson.id} className="card">
              <h3 className="lesson-card__title">{lesson.title}</h3>
              {lesson.status === 'demo' && <span className="badge badge--demo">Ukázková lekce</span>}
              <p>{lesson.summary}</p>
              <p className="meta-line">
                Odhad: {formatEstimate(lesson.estimatedActiveMinutes)} ·{' '}
                {entry === undefined
                  ? 'Nezahájeno'
                  : entry.status === 'completed'
                    ? `Dokončeno · aktivní čas ${formatDuration(entry.activeTimeMs)}`
                    : `Rozpracováno · aktivní čas ${formatDuration(entry.activeTimeMs)}`}
              </p>
              <Link className="button lesson-card__link" to={`/lekce/${lesson.id}`}>
                {entry === undefined
                  ? 'Začít lekci'
                  : entry.status === 'completed'
                    ? 'Otevřít znovu'
                    : 'Pokračovat v lekci'}
              </Link>
            </li>
          )
        })}
      </ul>
    </article>
  )
}
