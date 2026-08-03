import type { ReactNode } from 'react'
import type { z } from 'zod'
import type { summaryBlockSchema } from '../../content/schema'
import { Citations } from '../Citations'
import type { BlockViewProps } from './blockApi'

type SummaryBlock = z.infer<typeof summaryBlockSchema>

export function SummaryBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<SummaryBlock>): ReactNode {
  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>

      <h3>Hlavní mechanismus</h3>
      <p>{block.mainMechanism}</p>

      <h3>Důležitá rozlišení</h3>
      <ul>
        {block.distinctions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="callout callout--warning">
        <p className="callout__title">Nejčastější omyl</p>
        <p style={{ marginBottom: 0 }}>{block.commonMisconception}</p>
      </div>

      <h3>Co následuje</h3>
      <p>{block.nextTopic}</p>

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
    </section>
  )
}
