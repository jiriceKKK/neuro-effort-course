import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import type { predictionBlockSchema } from '../../content/schema'
import { shuffleOptionIds } from '../../learning/questionQuality/shuffle'
import { formatEstimate } from '../../learning/timing/activeTime'
import { Citations } from '../Citations'
import type { BlockViewProps } from './blockApi'

type PredictionBlock = z.infer<typeof predictionBlockSchema>

/**
 * Commit-before-you-learn.
 *
 * The learner has to choose an outcome before the explanation appears. Predictions are
 * not scored — the value is in noticing the difference between what you expected and
 * what the evidence says.
 */
export function PredictionBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<PredictionBlock>): ReactNode {
  const groupId = useId()
  const [order, setOrder] = useState<string[] | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const startedAtRef = useRef<number | null>(null)
  const revealRef = useRef<HTMLDivElement>(null)

  /** Lazily stamps the attempt start; never called during render. */
  const startedAt = (): number => (startedAtRef.current ??= Date.now())


  useEffect(() => {
    let active = true
    void (async () => {
      const draft = await api.loadDraft(block.question.id)
      if (!active) return
      if (draft !== null) {
        setOrder(draft.optionOrder)
        setSelectedOptionId(draft.selectedOptionId)
        return
      }
      const fresh = shuffleOptionIds(block.question.options.map((option) => option.id))
      setOrder(fresh)
      await api.saveDraft({
        blockId: block.id,
        questionId: block.question.id,
        optionOrder: fresh,
        attemptNumber: 1,
        selectedOptionId: null,
        confidence: null,
        freeResponse: null,
        revealed: false,
        startedAt: new Date(startedAt()).toISOString(),
      })
    })()
    return () => {
      active = false
    }
  }, [api, block.id, block.question.id, block.question.options])

  useEffect(() => {
    if (revealed) revealRef.current?.focus()
  }, [revealed])

  if (order === null) return <p role="status">Připravuji otázku…</p>

  const options = order
    .map((id) => block.question.options.find((option) => option.id === id))
    .filter((option): option is (typeof block.question.options)[number] => option !== undefined)
  const chosen = options.find((option) => option.id === selectedOptionId) ?? null

  async function handleReveal(): Promise<void> {
    if (selectedOptionId === null) return
    api.markInteraction()
    await api.recordAttempt({
      questionId: block.question.id,
      conceptIds: block.conceptIds,
      selectedOptionId,
      correctness:
        block.question.correctOptionId === undefined
          ? null
          : selectedOptionId === block.question.correctOptionId
            ? 2
            : 0,
      responseTimeMs: Date.now() - startedAt(),
    })
    await api.recordEvent('answer_submitted', {
      blockId: block.id,
      questionId: block.question.id,
      payload: { selectedOptionId, kind: 'prediction' },
    })
    await api.recordEvent('answer_revealed', { blockId: block.id, questionId: block.question.id })
    await api.clearDraft(block.question.id)
    setRevealed(true)
  }

  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={revealed}>
        <legend style={{ padding: 0, marginBottom: '0.75rem', fontWeight: 600 }}>
          {block.question.prompt}
        </legend>
        <ul className="options">
          {options.map((option) => (
            <li key={option.id}>
              <label
                className={`option ${option.id === selectedOptionId ? 'option--selected' : ''}`}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={option.id}
                  checked={option.id === selectedOptionId}
                  onChange={() => {
                    api.markInteraction()
                    setSelectedOptionId(option.id)
                  }}
                />
                <span>{option.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {!revealed && (
        <button
          type="button"
          className="button"
          disabled={selectedOptionId === null}
          onClick={() => void handleReveal()}
        >
          Potvrdit odhad
        </button>
      )}

      {revealed && (
        <>
          <div className="callout" ref={revealRef} tabIndex={-1} role="status" aria-live="polite">
            <p className="callout__title">Váš odhad</p>
            <p>{chosen?.text}</p>
            <p>{chosen?.feedback}</p>
            <p className="callout__title">Co na to model a data</p>
            <p style={{ marginBottom: 0 }}>{block.question.reveal}</p>
          </div>
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
