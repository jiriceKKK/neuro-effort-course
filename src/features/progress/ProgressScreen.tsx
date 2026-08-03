import { useMemo, type ReactNode } from 'react'
import { getContent } from '../../content/loader'
import { useLearnerSnapshot } from '../../persistence/local/useLearnerSnapshot'
import { computeConceptMastery } from '../../learning/mastery/mastery'
import { classifyAgainstEstimate, formatDuration, formatEstimate } from '../../learning/timing/activeTime'
import { isDue } from '../../learning/scheduler/scheduler'

/**
 * Progress overview.
 *
 * Two things worth looking at: where understanding is weak, and whether the published
 * time estimates match what learners actually spend. No streaks, no leaderboards.
 */
export function ProgressScreen(): ReactNode {
  const { lessonsById, conceptsById } = getContent()
  const snapshot = useLearnerSnapshot()
  const now = useMemo(() => new Date(), [])
  const mastery = useMemo(() => computeConceptMastery(snapshot.attempts), [snapshot.attempts])

  if (snapshot.loading) {
    return (
      <p role="status" aria-live="polite">
        Načítám data…
      </p>
    )
  }

  const dueCount = snapshot.reviews.filter((state) => isDue(state, now)).length

  return (
    <article>
      <h1>Váš postup</h1>

      <section className="card">
        <h2>Lekce a čas</h2>
        {snapshot.progress.length === 0 ? (
          <p className="empty-state">Zatím jste neotevřeli žádnou lekci.</p>
        ) : (
          <ul className="lesson-list">
            {snapshot.progress.map((entry) => {
              const lesson = lessonsById.get(entry.lessonId)
              if (lesson === undefined) return null
              const verdict = classifyAgainstEstimate(
                entry.activeTimeMs,
                lesson.minimumReasonableActiveMinutes,
                lesson.maximumReasonableActiveMinutes,
              )
              return (
                <li key={entry.lessonId}>
                  <h3 className="lesson-card__title">{lesson.title}</h3>
                  <p className="meta-line">
                    {entry.status === 'completed'
                      ? 'Dokončeno'
                      : entry.status === 'in_progress'
                        ? 'Rozpracováno'
                        : 'Nezahájeno'}{' '}
                    · odhad {formatEstimate(lesson.estimatedActiveMinutes)} · skutečný aktivní čas{' '}
                    {formatDuration(entry.activeTimeMs)}
                  </p>
                  <p className="meta-line">
                    {verdict === 'within-range' && 'Odpovídá odhadu lekce.'}
                    {verdict === 'below-range' && 'Rychleji, než odhad předpokládá.'}
                    {verdict === 'above-range' && 'Déle, než odhad předpokládá.'}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Koncepty</h2>
        {mastery.length === 0 ? (
          <p className="empty-state">
            Data se objeví po prvních odpovědích. Řadí se od nejslabšího konceptu.
          </p>
        ) : (
          <dl className="definition-list">
            {mastery.map((item) => {
              const concept = conceptsById.get(item.conceptId)
              return (
                <div key={item.conceptId}>
                  <dt>{concept?.name ?? item.conceptId}</dt>
                  <dd>
                    Úspěšnost {Math.round(item.accuracy * 100)} % z {item.attempts}{' '}
                    {item.attempts === 1 ? 'hodnoceného pokusu' : 'hodnocených pokusů'}
                    {item.calibrationGap !== null &&
                      ` · rozdíl jistoty a výsledku ${item.calibrationGap > 0 ? '+' : ''}${Math.round(item.calibrationGap * 100)} bodů`}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
        <p className="meta-line">
          Kladný rozdíl jistoty a výsledku znamená, že si věříte víc, než odpovídá vašim
          odpovědím. To je běžné a dá se to trénovat.
        </p>
      </section>

      <section className="card">
        <h2>Plán opakování</h2>
        <p>
          Sledovaných položek: {snapshot.reviews.length} · k opakování dnes: {dueCount}
        </p>
        <p className="meta-line">
          Uložených osobních poznámek: {snapshot.notes.length} · zaznamenaných odpovědí:{' '}
          {snapshot.attempts.length}
        </p>
      </section>
    </article>
  )
}
