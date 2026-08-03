import type { ReactNode } from 'react'
import type { z } from 'zod'
import type { multipleChoiceBlockSchema, scenarioBlockSchema } from '../../content/schema'
import { formatEstimate } from '../../learning/timing/activeTime'
import { MultipleChoiceQuestionView } from './MultipleChoiceQuestionView'
import type { BlockViewProps } from './blockApi'

type MultipleChoiceBlock = z.infer<typeof multipleChoiceBlockSchema>
type ScenarioBlock = z.infer<typeof scenarioBlockSchema>

export function MultipleChoiceBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<MultipleChoiceBlock>): ReactNode {
  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>
      <MultipleChoiceQuestionView
        question={block.question}
        blockId={block.id}
        conceptIds={block.conceptIds}
        sourceIds={block.sourceIds}
        api={api}
        onContinue={onContinue}
      />
    </section>
  )
}

/**
 * A scenario is a multiple-choice item applied to a new case: the learner has to
 * transfer the concept rather than recognise a definition.
 */
export function ScenarioBlockView({
  block,
  api,
  onContinue,
}: BlockViewProps<ScenarioBlock>): ReactNode {
  return (
    <section className="card" aria-labelledby={`block-${block.id}-title`}>
      <h2 id={`block-${block.id}-title`}>{block.title}</h2>
      <p className="meta-line">Odhadovaný čas: {formatEstimate(block.estimatedMinutes)}</p>
      <div className="callout">
        <p className="callout__title">Situace</p>
        <p style={{ marginBottom: 0 }}>{block.situation}</p>
      </div>
      <MultipleChoiceQuestionView
        question={block.question}
        blockId={block.id}
        conceptIds={block.conceptIds}
        sourceIds={block.sourceIds}
        api={api}
        onContinue={onContinue}
      />
    </section>
  )
}
