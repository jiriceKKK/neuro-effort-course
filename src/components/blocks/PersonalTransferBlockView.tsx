import { useEffect, useId, useState, type ReactNode } from 'react'
import type { z } from 'zod'
import type { personalTransferBlockSchema } from '../../content/schema'
import { formatEstimate } from '../../learning/timing/activeTime'
import type { BlockViewProps } from './blockApi'

type PersonalTransferBlock = z.infer<typeof personalTransferBlockSchema>

/**
 * Applies the concept to the learner's own behaviour.
 *
 * The response is a personal note: saved to IndexedDB immediately and synchronised to
 * Supabase once the learner is signed in.
 */
export function PersonalTransferBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<PersonalTransferBlock>): ReactNode {
  const fieldId = useId()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void api.loadNote(block.id).then((existing) => {
      if (!active) return
      setText(existing)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [api, block.id])

  const tooShort = text.trim().length < block.minimumCharacters

  async function handleSave(): Promise<void> {
    api.markInteraction()
    await api.saveNote(block.id, text)
    await api.recordEvent('personal_transfer_saved', {
      blockId: block.id,
      payload: { characters: text.trim().length },
    })
    setSaved(true)
  }

  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>
      <p>{block.prompt}</p>

      <ul>
        {block.guidance.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="field">
        <label className="field__label" htmlFor={fieldId}>
          Vaše odpověď
        </label>
        <span className="field__hint" id={`${fieldId}-hint`}>
          Odpověď se ukládá jen vám. Bez připojení zůstane v zařízení a odešle se později.
        </span>
        <textarea
          id={fieldId}
          className="textarea"
          aria-describedby={`${fieldId}-hint`}
          value={text}
          disabled={!loaded}
          placeholder={block.placeholder}
          onChange={(event) => {
            api.markInteraction()
            setText(event.target.value)
            setSaved(false)
          }}
        />
      </div>

      <div className="cluster">
        <button
          type="button"
          className="button"
          disabled={tooShort}
          onClick={() => void handleSave()}
        >
          Uložit odpověď
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            api.markInteraction()
            onContinue()
          }}
        >
          Pokračovat
        </button>
      </div>

      <p className="meta-line" role="status" aria-live="polite">
        {tooShort
          ? `Napište prosím alespoň ${block.minimumCharacters} znaků.`
          : saved
            ? 'Odpověď je uložena.'
            : ''}
      </p>
    </section>
  )
}
