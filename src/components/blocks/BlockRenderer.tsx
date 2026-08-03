import type { ReactNode } from 'react'
import type { LessonBlock } from '../../content/schema'
import { ExplanationBlockView } from './ExplanationBlockView'
import { MultipleChoiceBlockView, ScenarioBlockView } from './MultipleChoiceBlockView'
import { FreeRecallBlockView } from './FreeRecallBlockView'
import { PredictionBlockView } from './PredictionBlockView'
import { PersonalTransferBlockView } from './PersonalTransferBlockView'
import { SummaryBlockView } from './SummaryBlockView'
import type { BlockViewProps } from './blockApi'

/**
 * Dispatches a lesson block to its renderer.
 *
 * The switch is exhaustive: adding a variant to `lessonBlockSchema` without a renderer
 * is a TypeScript error, which is exactly the reminder an author needs. Planned block
 * types (sorting, matching, interactive_simulation, diagram, confidence_calibration,
 * delayed_review) plug in here with no other changes.
 */
export function BlockRenderer(props: BlockViewProps<LessonBlock>): ReactNode {
  const { block } = props

  switch (block.type) {
    case 'explanation':
      return <ExplanationBlockView {...props} block={block} />
    case 'multiple_choice':
      return <MultipleChoiceBlockView {...props} block={block} />
    case 'free_recall':
      return <FreeRecallBlockView {...props} block={block} />
    case 'prediction':
      return <PredictionBlockView {...props} block={block} />
    case 'scenario':
      return <ScenarioBlockView {...props} block={block} />
    case 'personal_transfer':
      return <PersonalTransferBlockView {...props} block={block} />
    case 'summary':
      return <SummaryBlockView {...props} block={block} />
  }
}
