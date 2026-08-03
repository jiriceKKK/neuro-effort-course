/**
 * Course-content validation CLI.
 *
 * Exits non-zero on any validation error, so `npm run check` and the deploy workflow
 * both refuse to ship broken content. Every message names the file, the object, the
 * field and the reason.
 *
 * Usage: npm run content:validate
 */
import {
  ContentValidationError,
  formatIssue,
  validateContentBundle,
} from '../src/content/validation'
import { loadRawContentBundle } from './loadContent'

function main(): void {
  let bundle
  try {
    bundle = loadRawContentBundle()
  } catch (error) {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }

  try {
    const content = validateContentBundle(bundle)

    console.log('Kontrola obsahu kurzu')
    console.log('─'.repeat(60))
    console.log(`  kurz:      ${content.course.title}`)
    console.log(`  moduly:    ${content.course.modules.length}`)
    console.log(`  lekce:     ${content.lessons.length}`)
    console.log(`  koncepty:  ${content.concepts.length}`)
    console.log(`  zdroje:    ${content.sources.length}`)
    console.log(`  otázky:    ${content.questions.length}`)

    for (const lesson of content.lessons) {
      const blockMinutes = lesson.blocks.reduce((sum, block) => sum + block.estimatedMinutes, 0)
      console.log(
        `  · ${lesson.id} [${lesson.status}] — ${lesson.blocks.length} bloků, ` +
          `${blockMinutes} min (odhad ${lesson.estimatedActiveMinutes} min, rozsah ` +
          `${lesson.minimumReasonableActiveMinutes}–${lesson.maximumReasonableActiveMinutes})`,
      )
    }

    if (content.warnings.length > 0) {
      console.log('\nUpozornění:')
      for (const warning of content.warnings) console.log(formatIssue(warning))
    }

    console.log('\n✔ Obsah kurzu je platný.\n')
  } catch (error) {
    if (error instanceof ContentValidationError) {
      console.error('\n✖ Obsah kurzu je neplatný:\n')
      for (const issue of error.issues) console.error(formatIssue(issue))
      console.error(`\n${error.issues.length} chyb. Opravte je a spusťte kontrolu znovu.\n`)
      process.exit(1)
    }
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

main()
