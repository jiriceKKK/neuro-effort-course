import { describe, expect, it } from 'vitest'
import { hashSeed, seededShuffle, shuffleOptionIds } from '../../src/learning/questionQuality/shuffle'
import { getContent } from '../../src/content/loader'

describe('option shuffling', () => {
  const optionIds = ['a', 'b', 'c', 'd']

  it('is a permutation: no option is lost or duplicated', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      expect([...seededShuffle(optionIds, seed)].sort()).toEqual([...optionIds].sort())
    }
  })

  it('does not mutate the input', () => {
    const input = [...optionIds]
    seededShuffle(input, 42)
    expect(input).toEqual(optionIds)
  })

  it('is deterministic for a given seed and varies across seeds', () => {
    expect(seededShuffle(optionIds, 7)).toEqual(seededShuffle(optionIds, 7))
    const orders = new Set(
      Array.from({ length: 60 }, (_, seed) => seededShuffle(optionIds, seed).join('')),
    )
    expect(orders.size).toBeGreaterThan(1)
  })

  it('reaches every position for the correct option over many attempts', () => {
    const positions = new Set(
      Array.from({ length: 500 }, (_, seed) => seededShuffle(optionIds, seed).indexOf('a')),
    )
    expect(positions).toEqual(new Set([0, 1, 2, 3]))
  })

  it('never changes which option ID is correct', () => {
    const questions = getContent()
      .questions.map((entry) => entry.multipleChoice)
      .filter((question): question is NonNullable<typeof question> => question !== null)

    expect(questions.length).toBeGreaterThan(0)
    for (const question of questions) {
      const ids = question.options.map((option) => option.id)
      for (let seed = 0; seed < 100; seed += 1) {
        const order = seededShuffle(ids, seed)
        // Evaluation compares IDs, so a correct answer stays correct at any position.
        expect(order).toContain(question.correctOptionId)
        const chosen = order[order.indexOf(question.correctOptionId)]
        expect(chosen === question.correctOptionId).toBe(true)
      }
    }
  })

  it('produces a stable seed from a string key', () => {
    expect(hashSeed('demo-rpe-q-signal')).toBe(hashSeed('demo-rpe-q-signal'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })

  it('shuffleOptionIds accepts an explicit seed for reproducibility', () => {
    expect(shuffleOptionIds(optionIds, 123)).toEqual(shuffleOptionIds(optionIds, 123))
  })
})
