import type { LessonBlock } from '../../content/schema'

/** Czech labels for block types, used in progress indicators and the course map. */
export const BLOCK_TYPE_LABELS: Record<LessonBlock['type'], string> = {
  explanation: 'Výklad',
  multiple_choice: 'Otázka s výběrem',
  free_recall: 'Vybavování',
  prediction: 'Odhad',
  scenario: 'Scénář',
  personal_transfer: 'Přenos do praxe',
  summary: 'Shrnutí',
}
