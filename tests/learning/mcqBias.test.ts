import { describe, expect, it } from 'vitest'
import {
  analyseQuestion,
  auditQuestions,
  LENGTH_RATIO_HARD_FAIL,
  median,
  type AuditableQuestion,
} from '../../src/learning/questionQuality/mcqBias'
import { collectAuditableQuestions } from '../../src/learning/questionQuality/collect'
import { getContent } from '../../src/content/loader'

function question(overrides: Partial<AuditableQuestion> = {}): AuditableQuestion {
  return {
    id: 'q-test',
    prompt: 'Která možnost popisuje mechanismus nejpřesněji?',
    correctOptionId: 'a',
    negative: false,
    cognitiveLevel: 'mechanism',
    lessonId: 'test-lesson',
    blockId: 'test-block',
    file: 'src/content/lessons/test-lesson.json',
    options: [
      { id: 'a', text: 'Rozdíl mezi očekáváním a výsledkem.', feedback: 'Správně — jde právě o tento rozdíl.' },
      { id: 'b', text: 'Velikost výsledné odměny samotné.', feedback: 'Nesprávně — popisuje odměnu, ne rozdíl.' },
      { id: 'c', text: 'Doba, po kterou odměna trvala.', feedback: 'Nesprávně — trvání není součástí modelu.' },
    ],
    ...overrides,
  }
}

describe('analyseQuestion', () => {
  it('measures option lengths and the ratio to the median distractor', () => {
    const analysis = analyseQuestion(question())
    expect(analysis.optionCount).toBe(3)
    expect(analysis.correctCharacters).toBe(35)
    expect(analysis.medianDistractorCharacters).toBe(median([33, 30]))
    expect(analysis.lengthRatio).toBeCloseTo(35 / 31.5, 5)
    expect(analysis.lengthRatio).toBeLessThan(1.3)
  })

  it('detects when the correct option is the longest', () => {
    const balanced = analyseQuestion(question())
    expect(balanced.correctIsLongest).toBe(true)

    const shortCorrect = analyseQuestion(
      question({
        correctOptionId: 'c',
      }),
    )
    expect(shortCorrect.correctIsLongest).toBe(false)
  })

  it('reports a reproducible correct-answer position', () => {
    const first = analyseQuestion(question())
    const second = analyseQuestion(question())
    expect(first.deterministicCorrectPosition).toBe(second.deterministicCorrectPosition)
    expect(first.deterministicCorrectPosition).toBeGreaterThanOrEqual(0)
  })
})

describe('auditQuestions — answer-length bias', () => {
  it('fails hard when the correct option is far longer than the distractors', () => {
    const result = auditQuestions([
      question({
        options: [
          {
            id: 'a',
            text: 'Rozdíl mezi očekávaným a skutečným výsledkem, který určuje, o kolik se očekávání posune do příště.',
            feedback: 'Správně, protože jde o odchylku od očekávání.',
          },
          { id: 'b', text: 'Velikost odměny.', feedback: 'Nesprávně, popisuje jen odměnu.' },
          { id: 'c', text: 'Trvání odměny.', feedback: 'Nesprávně, trvání model neřeší.' },
        ],
      }),
    ])

    const finding = result.findings.find((entry) => entry.rule === 'length-bias-hard')
    expect(finding?.level).toBe('error')
    expect(result.errorCount).toBeGreaterThan(0)
    expect(result.analyses[0]?.lengthRatio).toBeGreaterThan(LENGTH_RATIO_HARD_FAIL)
  })

  it('downgrades the hard failure to a pass when a justification is supplied', () => {
    const options = [
      {
        id: 'a',
        text: 'Rozdíl mezi očekávaným a skutečným výsledkem, který určuje, o kolik se očekávání posune do příště.',
        feedback: 'Správně, protože jde o odchylku od očekávání.',
      },
      { id: 'b', text: 'Velikost odměny.', feedback: 'Nesprávně, popisuje jen odměnu.' },
      { id: 'c', text: 'Trvání odměny.', feedback: 'Nesprávně, trvání model neřeší.' },
    ]
    const result = auditQuestions([
      question({ options, lengthBiasJustification: 'Definice nejde zkrátit bez ztráty přesnosti.' }),
    ])

    expect(result.findings.some((entry) => entry.rule === 'length-bias-hard')).toBe(false)
    // The remaining findings are the softer, informational ones.
    expect(result.findings.some((entry) => entry.rule === 'length-bias-soft')).toBe(true)
  })

  it('warns at the softer ratio threshold without failing the question', () => {
    const result = auditQuestions([
      question({
        options: [
          {
            id: 'a',
            text: 'Rozdíl mezi očekávaným a tím, co ve skutečnosti nastalo v pokusu.',
            feedback: 'Správně, jde o odchylku od očekávání.',
          },
          {
            id: 'b',
            text: 'Velikost odměny, kterou člověk nakonec dostal.',
            feedback: 'Nesprávně, popisuje jen velikost odměny.',
          },
          {
            id: 'c',
            text: 'Doba, po kterou odměna v daném pokusu trvala.',
            feedback: 'Nesprávně, trvání odměny model neřeší.',
          },
        ],
      }),
    ])

    const ratio = result.analyses[0]?.lengthRatio ?? 0
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(1.6)
    expect(result.findings.some((entry) => entry.rule === 'length-bias-soft')).toBe(true)
    expect(result.findings.some((entry) => entry.rule === 'length-bias-hard')).toBe(false)
  })

  it('fails the batch when the correct option is the longest too often', () => {
    const longestCorrect = (id: string): AuditableQuestion =>
      question({
        id,
        options: [
          {
            id: 'a',
            text: 'Správná možnost, o něco delší než ostatní volby.',
            feedback: 'Správně, protože odpovídá zadání otázky.',
          },
          { id: 'b', text: 'Kratší nesprávná možnost.', feedback: 'Nesprávně, zaměňuje dva pojmy.' },
          { id: 'c', text: 'Jiná nesprávná možnost.', feedback: 'Nesprávně, popisuje jiný jev.' },
        ],
      })

    const result = auditQuestions([
      longestCorrect('q1'),
      longestCorrect('q2'),
      longestCorrect('q3'),
    ])
    expect(result.batch.longestCorrectRatio).toBe(1)
    expect(result.findings.some((entry) => entry.rule === 'batch-longest-correct')).toBe(true)
    expect(result.errorCount).toBeGreaterThan(0)
  })
})

describe('auditQuestions — other cues', () => {
  it('rejects „všechny uvedené možnosti“ and „žádná z uvedených možností“', () => {
    const result = auditQuestions([
      question({
        options: [
          { id: 'a', text: 'Všechny uvedené možnosti platí.', feedback: 'Zakázaná formulace v možnosti.' },
          { id: 'b', text: 'Žádná z uvedených možností neplatí.', feedback: 'Také zakázaná formulace zde.' },
          { id: 'c', text: 'Rozdíl oproti očekávání.', feedback: 'Správná odpověď na tuto otázku.' },
        ],
      }),
    ])

    expect(result.findings.some((entry) => entry.rule === 'all-of-the-above')).toBe(true)
    expect(result.findings.some((entry) => entry.rule === 'none-of-the-above')).toBe(true)
  })

  it('requires meaningful, non-duplicated feedback on every option', () => {
    const result = auditQuestions([
      question({
        options: [
          { id: 'a', text: 'Rozdíl oproti očekávání.', feedback: 'Krátké.' },
          { id: 'b', text: 'Velikost odměny samotné.', feedback: 'Stejná zpětná vazba pro obě možnosti.' },
          { id: 'c', text: 'Trvání odměny v čase.', feedback: 'Stejná zpětná vazba pro obě možnosti.' },
        ],
      }),
    ])

    expect(result.findings.some((entry) => entry.rule === 'feedback-too-short')).toBe(true)
    expect(result.findings.some((entry) => entry.rule === 'feedback-duplicated')).toBe(true)
  })

  it('requires a negative stem to be declared and visually emphasised', () => {
    const undeclared = auditQuestions([
      question({ prompt: 'Co o chybě predikce NEPLATÍ?', negative: false }),
    ])
    expect(undeclared.findings.some((entry) => entry.rule === 'negation-undeclared')).toBe(true)

    const unemphasised = auditQuestions([
      question({ prompt: 'Co o chybě predikce neplatí?', negative: true }),
    ])
    expect(unemphasised.findings.some((entry) => entry.rule === 'negation-not-emphasised')).toBe(
      true,
    )
  })

  it('flags a correct option that shares far more stem vocabulary than any distractor', () => {
    const result = auditQuestions([
      question({
        prompt: 'Jak chyba predikce odměny ovlivňuje očekávání v příštím pokusu?',
        options: [
          {
            id: 'a',
            text: 'Chyba predikce odměny posouvá očekávání v příštím pokusu.',
            feedback: 'Správně, ale znění příliš kopíruje zadání otázky.',
          },
          { id: 'b', text: 'Roste hodnota vnímané odměny.', feedback: 'Nesprávně, popisuje jiný jev.' },
          { id: 'c', text: 'Klesá ochota vynaložit úsilí.', feedback: 'Nesprávně, to model netvrdí.' },
        ],
      }),
    ])

    expect(result.findings.some((entry) => entry.rule === 'lexical-overlap')).toBe(true)
  })
})

describe('shipped questions', () => {
  it('pass the audit with no hard failures', () => {
    const result = auditQuestions(collectAuditableQuestions(getContent()))
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([])
    expect(result.batch.questionCount).toBeGreaterThanOrEqual(4)
    expect(result.batch.longestCorrectRatio).toBeLessThanOrEqual(0.55)
  })

  it('keep recognition-only questions out of the majority', () => {
    const result = auditQuestions(collectAuditableQuestions(getContent()))
    expect(result.batch.recallLevelRatio).toBeLessThanOrEqual(0.6)
  })
})
