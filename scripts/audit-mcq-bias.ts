/**
 * Multiple-choice bias audit CLI.
 *
 * Reports, per question: option lengths, the ratio of the correct option to the median
 * distractor, whether the correct option is the longest, its position after a
 * deterministic shuffle, and lexical overlap with the stem. Batch-level statistics
 * follow. Exits non-zero on any hard failure.
 *
 * Thresholds and their rationale: docs/QUESTION_QUALITY.md
 *
 * Usage: npm run content:audit-mcq
 */
import { validateContentBundle } from '../src/content/validation'
import { collectAuditableQuestions } from '../src/learning/questionQuality/collect'
import {
  auditQuestions,
  LENGTH_RATIO_HARD_FAIL,
  LENGTH_RATIO_WARNING,
  LONGEST_CORRECT_BATCH_FAIL,
  LONGEST_CORRECT_BATCH_WARNING,
} from '../src/learning/questionQuality/mcqBias'
import { loadRawContentBundle } from './loadContent'

function main(): void {
  const content = validateContentBundle(loadRawContentBundle())
  const questions = collectAuditableQuestions(content)
  const result = auditQuestions(questions)

  console.log('Audit otázek s výběrem odpovědi')
  console.log('─'.repeat(72))
  console.log(
    `Prahy: tvrdá chyba > ${LENGTH_RATIO_HARD_FAIL}× medián distraktorů, ` +
      `upozornění > ${LENGTH_RATIO_WARNING}×; nejdelší správná možnost ` +
      `> ${(LONGEST_CORRECT_BATCH_FAIL * 100).toFixed(0)} % (chyba) / ` +
      `> ${(LONGEST_CORRECT_BATCH_WARNING * 100).toFixed(0)} % (upozornění)\n`,
  )

  for (const analysis of result.analyses) {
    console.log(`${analysis.questionId}  (${analysis.lessonId}/${analysis.blockId})`)
    console.log(
      `  poměr délky správné/medián distraktorů: ${analysis.lengthRatio.toFixed(2)}` +
        `  ·  správná je nejdelší: ${analysis.correctIsLongest ? 'ano' : 'ne'}` +
        `  ·  úroveň: ${analysis.cognitiveLevel}`,
    )
    console.log(
      `  znaky správné: ${analysis.correctCharacters}` +
        `  ·  medián distraktorů: ${analysis.medianDistractorCharacters}` +
        `  ·  slova: ${analysis.correctWords}/${analysis.medianDistractorWords}` +
        `  ·  rozpětí slov: ${analysis.wordCountSpread.toFixed(2)}×`,
    )
    console.log(
      `  shoda se zadáním — správná: ${analysis.stemOverlapCorrect}` +
        `, nejlepší distraktor: ${analysis.maxStemOverlapDistractor}` +
        `  ·  pozice po zamíchání: ${analysis.deterministicCorrectPosition + 1}/${analysis.optionCount}`,
    )
    for (const option of analysis.options) {
      console.log(
        `    ${option.isCorrect ? '✔' : ' '} ${option.id.padEnd(22)} ${String(option.characters).padStart(4)} znaků, ${String(option.words).padStart(3)} slov`,
      )
    }
    console.log('')
  }

  console.log('─'.repeat(72))
  console.log('Souhrn dávky')
  console.log(`  otázek:                          ${result.batch.questionCount}`)
  console.log(
    `  správná je nejdelší:             ${result.batch.longestCorrectCount} ` +
      `(${(result.batch.longestCorrectRatio * 100).toFixed(0)} %)`,
  )
  console.log(
    `  negativní zadání:                ${result.batch.negativeCount} ` +
      `(${(result.batch.negativeRatio * 100).toFixed(0)} %)`,
  )
  console.log(
    `  pouhé vybavení (recall):         ${result.batch.recallLevelCount} ` +
      `(${(result.batch.recallLevelRatio * 100).toFixed(0)} %)`,
  )
  console.log(
    `  rozdělení pozic správné odpovědi: ${result.batch.positionDistribution
      .map((count, index) => `${index + 1}:${count}`)
      .join('  ')}`,
  )

  const errors = result.findings.filter((finding) => finding.level === 'error')
  const warnings = result.findings.filter((finding) => finding.level === 'warning')

  if (warnings.length > 0) {
    console.log('\nUpozornění:')
    for (const finding of warnings) {
      console.log(`  [${finding.rule}] ${finding.questionId ?? 'dávka'}: ${finding.message}`)
    }
  }

  if (errors.length > 0) {
    console.error('\nChyby:')
    for (const finding of errors) {
      console.error(`  [${finding.rule}] ${finding.questionId ?? 'dávka'}: ${finding.message}`)
    }
    console.error(`\n✖ Audit selhal: ${errors.length} chyb, ${warnings.length} upozornění.\n`)
    process.exit(1)
  }

  console.log(`\n✔ Audit prošel. Upozornění: ${warnings.length}.\n`)
}

main()
