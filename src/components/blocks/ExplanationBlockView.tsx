import type { ReactNode } from 'react'
import type { z } from 'zod'
import type { explanationBlockSchema } from '../../content/schema'
import { Citations } from '../Citations'
import { formatEstimate } from '../../learning/timing/activeTime'
import type { BlockViewProps } from './blockApi'

type ExplanationBlock = z.infer<typeof explanationBlockSchema>

export function ExplanationBlockView({
  block,
  onContinue,
  api,
}: BlockViewProps<ExplanationBlock>): ReactNode {
  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>

      {block.paragraphs.map((paragraph, index) => (
        <p key={`${block.id}-p-${index}`}>{paragraph}</p>
      ))}

      {block.model !== undefined && (
        <>
          <div className="table-scroll">
            <table className="model-table">
              <caption style={{ textAlign: 'left', paddingBottom: '0.5rem' }}>
                {block.model.caption}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Situace</th>
                  <th scope="col">Očekávání</th>
                  <th scope="col">Skutečný výsledek</th>
                  <th scope="col">Signál</th>
                </tr>
              </thead>
              <tbody>
                {block.model.rows.map((row, index) => (
                  <tr key={`${block.id}-row-${index}`}>
                    <td>{row.situation}</td>
                    <td>{row.expectation}</td>
                    <td>{row.outcome}</td>
                    <td>{row.signal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout callout--warning">
            <p className="callout__title">Hranice modelu</p>
            <p style={{ marginBottom: 0 }}>{block.model.caveat}</p>
          </div>
        </>
      )}

      {block.keyPrinciple !== undefined && (
        <div className="callout">
          <p className="callout__title">Klíčový princip</p>
          <p style={{ marginBottom: 0 }}>{block.keyPrinciple}</p>
        </div>
      )}

      {block.commonMistake !== undefined && (
        <div className="callout callout--warning">
          <p className="callout__title">Pozor na omyl</p>
          <p style={{ marginBottom: 0 }}>{block.commonMistake}</p>
        </div>
      )}

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
