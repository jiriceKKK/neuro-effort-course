import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { MultipleChoiceQuestion } from '../../content/schema'
import { shuffleOptionIds } from '../../learning/questionQuality/shuffle'
import { Citations } from '../Citations'
import { ConfidenceSlider } from '../ConfidenceSlider'
import { renderNegation, type BlockApi } from './blockApi'

/**
 * The multiple-choice interaction, shared by `multiple_choice` and `scenario` blocks.
 *
 * Required order: options are shown shuffled → the learner picks one → records
 * confidence → submits → only then is anything revealed. The shuffled order is stored
 * with the attempt draft, so reloading mid-question never reshuffles the options, and
 * the answer is always identified by option ID rather than by position.
 */
export function MultipleChoiceQuestionView({
  question,
  blockId,
  conceptIds,
  sourceIds,
  api,
  onContinue,
}: {
  question: MultipleChoiceQuestion
  blockId: string
  conceptIds: string[]
  sourceIds: string[]
  api: BlockApi
  onContinue: () => void
}): ReactNode {
  const groupId = useId()
  const [order, setOrder] = useState<string[] | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  /** Lazily stamps the attempt start; never called during render. */
  const startedAt = (): number => (startedAtRef.current ??= Date.now())


  useEffect(() => {
    let active = true
    void (async () => {
      const draft = await api.loadDraft(question.id)
      if (!active) return
      if (draft !== null) {
        setOrder(draft.optionOrder)
        setSelectedOptionId(draft.selectedOptionId)
        setConfidence(draft.confidence)
        startedAtRef.current = new Date(draft.startedAt).getTime()
        return
      }
      const fresh = shuffleOptionIds(question.options.map((option) => option.id))
      setOrder(fresh)
      await api.saveDraft({
        blockId,
        questionId: question.id,
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
  }, [api, blockId, question.id, question.options])

  const persistDraft = useCallback(
    (patch: { selectedOptionId?: string | null; confidence?: number | null }) => {
      if (order === null) return
      void api.saveDraft({
        blockId,
        questionId: question.id,
        optionOrder: order,
        attemptNumber: 1,
        selectedOptionId: patch.selectedOptionId ?? selectedOptionId,
        confidence: patch.confidence ?? confidence,
        freeResponse: null,
        revealed: false,
        startedAt: new Date(startedAt()).toISOString(),
      })
    },
    [api, blockId, confidence, order, question.id, selectedOptionId],
  )

  useEffect(() => {
    if (submitted) feedbackRef.current?.focus()
  }, [submitted])

  if (order === null) {
    return <p role="status">Připravuji otázku…</p>
  }

  const options = order
    .map((id) => question.options.find((option) => option.id === id))
    .filter((option): option is (typeof question.options)[number] => option !== undefined)
  const isCorrect = selectedOptionId === question.correctOptionId

  async function handleSubmit(): Promise<void> {
    if (selectedOptionId === null || confidence === null || submitted) return
    api.markInteraction()
    const correct = selectedOptionId === question.correctOptionId
    const conceptId = conceptIds[0] ?? ''

    await api.recordEvent('confidence_recorded', {
      blockId,
      questionId: question.id,
      payload: { confidence },
    })
    await api.recordAttempt({
      questionId: question.id,
      conceptIds,
      selectedOptionId,
      correctness: correct ? 2 : 0,
      confidence,
      responseTimeMs: Date.now() - startedAt(),
    })
    await api.recordEvent('answer_submitted', {
      blockId,
      questionId: question.id,
      conceptId,
      payload: { selectedOptionId, correct },
    })
    await api.recordEvent('answer_revealed', { blockId, questionId: question.id })

    // A wrong answer resets the item to tomorrow; a correct one earns a normal interval.
    const due = await api.recordReview(question.id, conceptId, correct ? 'good' : 'fail')
    setDueDate(due)
    await api.clearDraft(question.id)
    setSubmitted(true)
  }

  return (
    <>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={submitted}>
        <legend style={{ padding: 0, marginBottom: '0.75rem', fontWeight: 600 }}>
          {question.negative
            ? renderNegation(question.prompt).map((part, index) =>
                typeof part === 'string' ? (
                  <span key={index}>{part}</span>
                ) : (
                  <strong key={index}>{part.negation}</strong>
                ),
              )
            : question.prompt}
        </legend>

        <ul className="options">
          {options.map((option) => {
            const selected = option.id === selectedOptionId
            const correctOption = option.id === question.correctOptionId
            const className = [
              'option',
              !submitted && selected ? 'option--selected' : '',
              submitted && correctOption ? 'option--correct' : '',
              submitted && selected && !correctOption ? 'option--incorrect' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <li key={option.id}>
                <label className={className}>
                  <input
                    type="radio"
                    name={groupId}
                    value={option.id}
                    checked={selected}
                    onChange={() => {
                      api.markInteraction()
                      setSelectedOptionId(option.id)
                      persistDraft({ selectedOptionId: option.id })
                    }}
                  />
                  <span>
                    {submitted && (
                      <span className="option__marker">
                        {correctOption
                          ? 'Správná odpověď'
                          : selected
                            ? 'Vaše odpověď — nesprávná'
                            : 'Nesprávná možnost'}
                      </span>
                    )}
                    {option.text}
                    {submitted && <span className="option__feedback">{option.feedback}</span>}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {!submitted && (
        <>
          <ConfidenceSlider value={confidence} onChange={(value) => {
            api.markInteraction()
            setConfidence(value)
            persistDraft({ confidence: value })
          }} />
          <button
            type="button"
            className="button"
            disabled={selectedOptionId === null || confidence === null}
            onClick={() => void handleSubmit()}
          >
            Odeslat odpověď
          </button>
          {(selectedOptionId === null || confidence === null) && (
            <p className="meta-line">
              Nejprve zvolte možnost a nastavte svou jistotu. Teprve pak se zobrazí řešení.
            </p>
          )}
        </>
      )}

      {submitted && (
        <div
          className={`callout ${isCorrect ? 'callout--success' : 'callout--danger'}`}
          ref={feedbackRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
        >
          <p className="callout__title">
            {isCorrect ? 'Odpověděli jste správně.' : 'Odpověděli jste nesprávně.'}
          </p>
          <p>{question.explanation}</p>
          {confidence !== null && (
            <p className="meta-line">
              Vaše jistota před odpovědí: {confidence} %.
              {isCorrect && confidence <= 40 && ' Odpověď byla správně, ale jistota nízká — vyplatí se položku zopakovat.'}
              {!isCorrect && confidence >= 70 && ' Vysoká jistota u nesprávné odpovědi je typický signál přeceňování.'}
            </p>
          )}
          {dueDate !== null && <p className="meta-line">Další opakování: {dueDate}</p>}
        </div>
      )}

      {submitted && (
        <>
          <Citations sourceIds={sourceIds} />
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
    </>
  )
}
