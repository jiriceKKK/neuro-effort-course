import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { findQuestionLocation, getContent } from '../../content/loader'
import { getLocalRepository } from '../../persistence/local/repository'
import { useLearnerSnapshot } from '../../persistence/local/useLearnerSnapshot'
import { useSync } from '../../persistence/sync/syncContext'
import { ConfidenceSlider } from '../../components/ConfidenceSlider'
import { Citations } from '../../components/Citations'
import { formatDueDate, scheduleReview, sortByUrgency } from '../../learning/scheduler/scheduler'
import { formatCount } from '../../learning/mastery/mastery'
import { REVIEW_RATING_LABELS, type ReviewRating, type ReviewState } from '../../types/learner'

const RATINGS: ReviewRating[] = ['fail', 'hard', 'good', 'easy']

interface ReviewCard {
  state: ReviewState
  prompt: string
  answer: string
  explanation: string | null
  sourceIds: string[]
  lessonTitle: string
}

/** Turns a scheduled item back into something the learner can be asked. */
function buildCard(state: ReviewState): ReviewCard | null {
  const location = findQuestionLocation(state.itemId)
  if (location === null) return null
  const { lesson, block } = location

  switch (block.type) {
    case 'multiple_choice':
    case 'scenario': {
      const correct = block.question.options.find(
        (option) => option.id === block.question.correctOptionId,
      )
      return {
        state,
        prompt: block.type === 'scenario' ? `${block.situation}\n\n${block.question.prompt}` : block.question.prompt,
        answer: correct?.text ?? '',
        explanation: block.question.explanation,
        sourceIds: block.sourceIds,
        lessonTitle: lesson.title,
      }
    }
    case 'free_recall':
      return {
        state,
        prompt: block.question.prompt,
        answer: block.question.modelAnswer,
        explanation: block.question.explanation ?? null,
        sourceIds: block.sourceIds,
        lessonTitle: lesson.title,
      }
    default:
      return null
  }
}

/**
 * Review queue.
 *
 * One card at a time: recall → record confidence → reveal → self-rate. A `fail` puts the
 * card back at the end of the current session in addition to resetting its interval.
 */
export function ReviewScreen(): ReactNode {
  const snapshot = useLearnerSnapshot()
  const { notifyLocalChange } = useSync()
  const repository = useMemo(() => getLocalRepository(), [])
  const now = useMemo(() => new Date(), [])
  /**
   * `null` means "not yet touched in this session", in which case the queue is derived
   * straight from the loaded review states. Rating an item switches to the session
   * queue, which is what lets a failed card come back later in the same sitting.
   */
  const [sessionQueue, setSessionQueue] = useState<ReviewState[] | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [lastDue, setLastDue] = useState<string | null>(null)
  const revealRef = useRef<HTMLDivElement>(null)

  const queue = useMemo(
    () => sessionQueue ?? (snapshot.loading ? null : sortByUrgency(snapshot.reviews, now)),
    [now, sessionQueue, snapshot.loading, snapshot.reviews],
  )

  useEffect(() => {
    if (revealed) revealRef.current?.focus()
  }, [revealed])

  const current = queue?.[0] ?? null
  const card = useMemo(() => (current === null ? null : buildCard(current)), [current])

  const handleRating = useCallback(
    async (rating: ReviewRating) => {
      if (current === null || queue === null) return
      const { state, repeatInSession } = scheduleReview({
        previous: current,
        rating,
        now: new Date(),
        userId: current.userId,
        itemId: current.itemId,
        itemType: current.itemType,
        conceptId: current.conceptId,
      })
      await repository.saveReviewState(state)
      await repository.appendEvent({
        userId: current.userId,
        eventType: 'review_rated',
        questionId: current.itemId,
        conceptId: current.conceptId,
        payload: { rating, confidence, intervalDays: state.intervalDays },
      })
      notifyLocalChange()

      setLastDue(formatDueDate(state.dueAt))
      setConfidence(null)
      setRevealed(false)
      setSessionQueue(repeatInSession ? [...queue.slice(1), state] : queue.slice(1))
    },
    [confidence, current, notifyLocalChange, queue, repository],
  )

  if (snapshot.loading || queue === null) {
    return (
      <p role="status" aria-live="polite">
        Načítám opakování…
      </p>
    )
  }

  const totalConcepts = getContent().concepts.length

  if (current === null) {
    return (
      <article>
        <h1>Opakování</h1>
        <div className="card empty-state">
          <p>Nic k opakování. Položky se objeví, jakmile v lekci odpovíte na otázku.</p>
          {lastDue !== null && <p className="meta-line">Poslední naplánované opakování: {lastDue}</p>}
          <Link className="button lesson-card__link" to="/kurz">
            Otevřít mapu kurzu
          </Link>
        </div>
      </article>
    )
  }

  if (card === null) {
    return (
      <article>
        <h1>Opakování</h1>
        <div className="card">
          <p>
            Položka „{current.itemId}“ už v kurzu neexistuje — patrně se změnil obsah lekce.
            Můžete ji z fronty odebrat.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setSessionQueue(queue.slice(1))}
          >
            Přeskočit položku
          </button>
        </div>
      </article>
    )
  }

  return (
    <article>
      <h1>Opakování</h1>
      <p className="meta-line">
        Ve frontě {formatCount(queue.length)} · v kurzu je {totalConcepts} sledovaných konceptů
      </p>

      <section className="card">
        <p className="meta-line">Z lekce: {card.lessonTitle}</p>
        <h2>Vybavte si odpověď</h2>
        <p className="preformatted">{card.prompt}</p>

        {!revealed && (
          <>
            <ConfidenceSlider value={confidence} onChange={setConfidence} />
            <button
              type="button"
              className="button"
              disabled={confidence === null}
              onClick={() => setRevealed(true)}
            >
              Zobrazit řešení
            </button>
            {confidence === null && (
              <p className="meta-line">
                Nejprve zapište jistotu. Odhalení řešení bez pokusu o vybavení nemá efekt.
              </p>
            )}
          </>
        )}

        {revealed && (
          <>
            <div className="callout" ref={revealRef} tabIndex={-1} role="status" aria-live="polite">
              <p className="callout__title">Řešení</p>
              <p>{card.answer}</p>
              {card.explanation !== null && <p style={{ marginBottom: 0 }}>{card.explanation}</p>}
            </div>
            <Citations sourceIds={card.sourceIds} />

            <h3>Jak vám to šlo?</h3>
            <div className="ratings">
              {RATINGS.map((rating) => (
                <button
                  key={rating}
                  type="button"
                  className="button button--secondary"
                  onClick={() => void handleRating(rating)}
                >
                  {REVIEW_RATING_LABELS[rating]}
                </button>
              ))}
            </div>
            <p className="meta-line">
              „Nezvládl jsem“ vrátí položku ještě do dnešní fronty a naplánuje ji na zítřek.
            </p>
          </>
        )}
      </section>

      {lastDue !== null && (
        <p className="meta-line" role="status" aria-live="polite">
          Předchozí položka je naplánovaná na {lastDue}.
        </p>
      )}
    </article>
  )
}
