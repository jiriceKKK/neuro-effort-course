import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LessonRunnerScreen } from '../../src/features/lessons/LessonRunnerScreen'
import { LocalRepository } from '../../src/persistence/local/repository'
import type { LearningDatabase } from '../../src/persistence/local/db'
import { getLesson } from '../../src/content/loader'
import { TestProviders, useFreshDatabase } from '../helpers/render'

/**
 * End-to-end pass through a real demo lesson, using the real content, real Dexie and the
 * real block renderers. Only authentication and the remote repository are stubbed.
 */

let db: LearningDatabase

beforeEach(async () => {
  db = await useFreshDatabase()
})

afterEach(async () => {
  // Unmount first so the runner's unmount flush finishes before the database goes away.
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 0))
  db.close()
  await db.delete()
})

/** Range inputs are driven with a change event; jsdom does not implement dragging. */
function setConfidence(percent: number): void {
  fireEvent.change(screen.getByLabelText('Jak jistý/á si jste svou odpovědí?'), {
    target: { value: String(percent) },
  })
}

function renderLesson(lessonId: string) {
  return render(
    <TestProviders initialEntries={[`/lekce/${lessonId}`]} path="/lekce/:lessonId">
      <LessonRunnerScreen />
    </TestProviders>,
  )
}

async function continueBlock(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Pokračovat' }))
}

describe('lesson runner — demo-evidence', () => {
  it('answers an MCQ with confidence, shows feedback, completes and survives a reload', async () => {
    const user = userEvent.setup()
    const lesson = getLesson('demo-evidence')
    expect(lesson).not.toBeNull()

    const view = renderLesson('demo-evidence')

    // 1. The demo banner is visible before any content.
    expect(
      await screen.findByText(/Ukázková lekce pro ověření aplikace/),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Jak poznat silnější psychologický důkaz' })).toBeInTheDocument()

    // 2. Prediction block: commit before reading anything.
    await user.click(
      await screen.findByRole('radio', {
        name: /Randomizovaný experiment, protože náhodné rozdělení srovnává obě skupiny/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Potvrdit odhad' }))
    expect(await screen.findByText(/Co na to model a data/)).toBeInTheDocument()
    await continueBlock(user)

    // 3. Explanation block.
    expect(await screen.findByRole('heading', { name: /Pět typů důkazu/ })).toBeInTheDocument()
    expect(screen.getByText('Klíčový princip')).toBeInTheDocument()
    expect(screen.getByText('Pozor na omyl')).toBeInTheDocument()
    await continueBlock(user)

    // 4. Multiple-choice block: nothing is revealed before an answer and a confidence.
    expect(await screen.findByRole('heading', { name: 'Co z toho vyplývá' })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Odeslat odpověď' })
    expect(submit).toBeDisabled()
    expect(screen.queryByText('Správná odpověď')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', { name: /Mezi ranním cvičením a nižší prokrastinací je vztah/ }),
    )
    expect(screen.getByRole('button', { name: 'Odeslat odpověď' })).toBeDisabled()

    setConfidence(70)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Odeslat odpověď' })).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'Odeslat odpověď' }))

    // 5. Feedback appears, announced to assistive technology.
    const feedback = await screen.findByText('Odpověděli jste správně.')
    expect(feedback).toBeInTheDocument()
    expect(screen.getByText('Správná odpověď')).toBeInTheDocument()
    expect(screen.getByText(/Další opakování:/)).toBeInTheDocument()

    // The attempt is stored by option ID, never by position.
    await waitFor(async () => {
      const attempts = await new LocalRepository(db).listAttempts('test-user')
      const mcqAttempt = attempts.find((a) => a.questionId === 'demo-evidence-q-korelace')
      expect(mcqAttempt?.selectedOptionId).toBe('vztah')
      expect(mcqAttempt?.correctness).toBe(2)
      expect(mcqAttempt?.confidence).not.toBeNull()
    })

    // A review item now exists for the answered question.
    await waitFor(async () => {
      const reviews = await new LocalRepository(db).listReviewStates('test-user')
      expect(reviews.map((r) => r.itemId)).toContain('demo-evidence-q-korelace')
    })

    await continueBlock(user)

    // 6. Scenario block.
    expect(await screen.findByRole('heading', { name: /Nová metaanalýza/ })).toBeInTheDocument()
    await user.click(
      screen.getByRole('radio', { name: /Ověřit kvalitu vstupních studií/ }),
    )
    setConfidence(60)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Odeslat odpověď' })).toBeEnabled(),
    )
    await user.click(screen.getByRole('button', { name: 'Odeslat odpověď' }))
    expect(await screen.findByText('Odpověděli jste správně.')).toBeInTheDocument()
    await continueBlock(user)

    // 7. Free recall: the model answer stays hidden until confidence is recorded.
    expect(await screen.findByRole('heading', { name: 'Vysvětlete to vlastními slovy' })).toBeInTheDocument()
    expect(screen.queryByText('Vzorová odpověď')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nevím' }))
    expect(screen.queryByText('Vzorová odpověď')).not.toBeInTheDocument()

    setConfidence(20)
    await user.click(screen.getByRole('button', { name: 'Zobrazit vzorovou odpověď' }))
    expect(await screen.findByText('Vzorová odpověď')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Těžké' }))
    await continueBlock(user)

    // 8. Summary.
    expect(await screen.findByRole('heading', { name: 'Shrnutí' })).toBeInTheDocument()
    await continueBlock(user)

    // 9. Personal transfer — the final block; „Pokračovat“ completes the lesson.
    expect(await screen.findByRole('heading', { name: 'Přenos do vlastní praxe' })).toBeInTheDocument()
    await user.type(
      screen.getByLabelText('Vaše odpověď'),
      'Tvrzení o ranním vstávání se opíralo jen o osobní příběh, chybí srovnávací skupina.',
    )
    await user.click(screen.getByRole('button', { name: 'Uložit odpověď' }))
    expect(await screen.findByText('Odpověď je uložena.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }))

    // 10. Completion screen reports estimate against measured active time.
    expect(await screen.findByRole('heading', { name: 'Lekce dokončena' })).toBeInTheDocument()
    expect(screen.getByText(/Odhad: 9 minut/)).toBeInTheDocument()
    expect(screen.getByText(/Skutečný aktivní čas:/)).toBeInTheDocument()

    // 11. Reload: unmount and mount again against the same IndexedDB.
    view.unmount()
    renderLesson('demo-evidence')

    expect(await screen.findByRole('heading', { name: 'Lekce dokončena' })).toBeInTheDocument()

    const progress = await new LocalRepository(db).getLessonProgress('test-user', 'demo-evidence')
    expect(progress?.status).toBe('completed')
    expect(progress?.completedAt).not.toBeNull()

    const note = await new LocalRepository(db).getPersonalNote(
      'test-user',
      'demo-evidence',
      'prenos',
    )
    expect(note?.note).toContain('osobní příběh')
  }, 60_000)
})

describe('lesson runner — resume', () => {
  it('reopens an unfinished lesson at the block the learner left', async () => {
    const user = userEvent.setup()
    const view = renderLesson('demo-rpe')

    await user.click(
      await screen.findByRole('radio', { name: /U prvního, protože výsledek se nejvíc rozešel/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Potvrdit odhad' }))
    await continueBlock(user)

    expect(await screen.findByRole('heading', { name: 'Rozdíl, ne velikost' })).toBeInTheDocument()
    await waitFor(async () => {
      const progress = await new LocalRepository(db).getLessonProgress('test-user', 'demo-rpe')
      expect(progress?.currentBlockIndex).toBe(1)
      expect(progress?.status).toBe('in_progress')
    })

    view.unmount()
    renderLesson('demo-rpe')

    expect(await screen.findByRole('heading', { name: 'Rozdíl, ne velikost' })).toBeInTheDocument()
    expect(screen.getByText(/Blok 2 z 9/)).toBeInTheDocument()
  }, 30_000)

  it('keeps the shuffled option order across a reload of an unfinished question', async () => {
    const user = userEvent.setup()
    const view = renderLesson('demo-rpe')

    // Walk to the first multiple-choice block.
    await user.click(await screen.findByRole('radio', { name: /U prvního/ }))
    await user.click(screen.getByRole('button', { name: 'Potvrdit odhad' }))
    await continueBlock(user) // prediction → explanation
    await continueBlock(user) // explanation → model
    await continueBlock(user) // model → MCQ

    // The rendered order of the radio inputs *is* the order the learner sees.
    const readOrder = async (): Promise<string[]> =>
      (await screen.findAllByRole('radio')).map((input) => (input as HTMLInputElement).value)

    expect(await screen.findByRole('heading', { name: 'Očekávaný výsledek' })).toBeInTheDocument()
    const firstOrder = await readOrder()
    expect(firstOrder).toHaveLength(4)

    view.unmount()
    renderLesson('demo-rpe')
    expect(await screen.findByRole('heading', { name: 'Očekávaný výsledek' })).toBeInTheDocument()

    expect(await readOrder()).toEqual(firstOrder)
  }, 30_000)
})
