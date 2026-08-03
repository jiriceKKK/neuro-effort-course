import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import type { freeRecallBlockSchema } from '../../content/schema'
import { Citations } from '../Citations'
import { ConfidenceSlider } from '../ConfidenceSlider'
import { formatEstimate } from '../../learning/timing/activeTime'
import { REVIEW_RATING_LABELS, type ReviewRating } from '../../types/learner'
import type { BlockViewProps } from './blockApi'

type FreeRecallBlock = z.infer<typeof freeRecallBlockSchema>

type Stage = 'answering' | 'confidence' | 'revealed' | 'rated'

const RATINGS: ReviewRating[] = ['fail', 'hard', 'good', 'easy']

/**
 * Free recall.
 *
 * The model answer stays hidden until the learner has committed to an attempt (or
 * explicitly chosen „Nevím“) *and* recorded confidence. Responses are not graded
 * automatically — the learner self-rates against an explicit checklist.
 */
export function FreeRecallBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<FreeRecallBlock>): ReactNode {
  const answerId = useId()
  const [stage, setStage] = useState<Stage>('answering')
  const [answer, setAnswer] = useState('')
  const [dontKnow, setDontKnow] = useState(false)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const revealRef = useRef<HTMLDivElement>(null)

  /** Lazily stamps the attempt start; never called during render. */
  const startedAt = (): number => (startedAtRef.current ??= Date.now())


  useEffect(() => {
    if (stage === 'revealed') revealRef.current?.focus()
  }, [stage])

  async function handleReveal(): Promise<void> {
    if (confidence === null) return
    api.markInteraction()
    await api.recordEvent('confidence_recorded', {
      blockId: block.id,
      questionId: block.question.id,
      payload: { confidence },
    })
    await api.recordAttempt({
      questionId: block.question.id,
      conceptIds: block.conceptIds,
      freeResponse: dontKnow ? null : answer,
      // Free recall is self-rated; correctness is filled in by the rating below.
      correctness: null,
      confidence,
      responseTimeMs: Date.now() - startedAt(),
    })
    await api.recordEvent('answer_revealed', {
      blockId: block.id,
      questionId: block.question.id,
      payload: { dontKnow },
    })
    setStage('revealed')
  }

  async function handleRating(rating: ReviewRating): Promise<void> {
    api.markInteraction()
    const conceptId = block.conceptIds[0] ?? ''
    const due = await api.recordReview(block.question.id, conceptId, rating)
    await api.recordEvent('review_rated', {
      blockId: block.id,
      questionId: block.question.id,
      conceptId,
      payload: { rating },
    })
    setDueDate(due)
    setStage('rated')
  }

  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>
      <p>{block.question.prompt}</p>

      <div className="field">
        <label className="field__label" htmlFor={answerId}>
          Vaše odpověď
        </label>
        <textarea
          id={answerId}
          className="textarea"
          value={answer}
          disabled={stage !== 'answering' || dontKnow}
          onChange={(event) => {
            api.markInteraction()
            setAnswer(event.target.value)
          }}
          placeholder="Napište odpověď vlastními slovy…"
        />
      </div>

      {stage === 'answering' && (
        <div className="cluster">
          <button
            type="button"
            className="button"
            disabled={answer.trim().length === 0 && !dontKnow}
            onClick={() => {
              api.markInteraction()
              setStage('confidence')
            }}
          >
            Mám odpověď
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              api.markInteraction()
              setDontKnow(true)
              setAnswer('')
              setStage('confidence')
            }}
          >
            Nevím
          </button>
        </div>
      )}

      {stage === 'confidence' && (
        <>
          {dontKnow && (
            <p className="meta-line">
              Zvolili jste „Nevím“. To je poctivější než odhad naslepo a pro plánování
              opakování je to užitečná informace.
            </p>
          )}
          <ConfidenceSlider
            value={confidence}
            onChange={(value) => {
              api.markInteraction()
              setConfidence(value)
            }}
          />
          <button
            type="button"
            className="button"
            disabled={confidence === null}
            onClick={() => void handleReveal()}
          >
            Zobrazit vzorovou odpověď
          </button>
          {confidence === null && (
            <p className="meta-line">Nejprve nastavte svou jistotu. Pak se odhalí řešení.</p>
          )}
        </>
      )}

      {(stage === 'revealed' || stage === 'rated') && (
        <div className="callout" ref={revealRef} tabIndex={-1} role="status" aria-live="polite">
          <p className="callout__title">Vzorová odpověď</p>
          <p>{block.question.modelAnswer}</p>
          <p className="callout__title">Co měla odpověď obsahovat</p>
          <ul>
            {block.question.requiredElements.map((element) => (
              <li key={element}>{element}</li>
            ))}
          </ul>
          {block.question.explanation !== undefined && (
            <p style={{ marginBottom: 0 }}>{block.question.explanation}</p>
          )}
        </div>
      )}

      {stage === 'revealed' && (
        <>
          <h3>Jak jste na tom byli?</h3>
          <p className="meta-line">
            Porovnejte svou odpověď se vzorovou a ohodnoťte se. Hodnocení určuje, kdy se
            položka objeví znovu.
          </p>
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
        </>
      )}

      {stage === 'rated' && (
        <>
          {dueDate !== null && <p className="meta-line">Další opakování: {dueDate}</p>}
          <Citations sourceIds={block.sourceIds} />
          <button
            type="button"
            className="button"
            onClick={() => {
              api.markInteraction()
              onContinue()
            }}
          >
            Pokračovat
          </button>
        </>
      )}
    </section>
  )
}
