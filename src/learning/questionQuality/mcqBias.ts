/**
 * Multiple-choice bias analysis.
 *
 * A learner must not be able to find the correct option without understanding the
 * content. The measurable part of that — length, position, structure and lexical
 * overlap — is checked here, and the same code backs both `npm run content:audit-mcq`
 * and the unit tests. Rules and thresholds are documented in docs/QUESTION_QUALITY.md.
 */
import { hashSeed, seededShuffle } from './shuffle'

export interface AuditableOption {
  id: string
  text: string
  feedback: string
}

export interface AuditableQuestion {
  id: string
  prompt: string
  options: readonly AuditableOption[]
  correctOptionId: string
  negative: boolean
  lengthBiasJustification?: string | undefined
  cognitiveLevel: string
  /** Provenance, used to make findings actionable. */
  lessonId: string
  blockId: string
  file: string
}

/** Above this ratio the length cue is treated as disqualifying. */
export const LENGTH_RATIO_HARD_FAIL = 1.6
/** Above this ratio the question is flagged for review. */
export const LENGTH_RATIO_WARNING = 1.3
/** Share of questions whose correct option is the longest, above which the batch fails. */
export const LONGEST_CORRECT_BATCH_FAIL = 0.55
export const LONGEST_CORRECT_BATCH_WARNING = 0.4
/** Negative stems ("Co NEplatí…") should stay rare. */
export const NEGATIVE_QUESTION_BATCH_WARNING = 0.2
/** Recognition-level items should not dominate a batch. */
export const RECALL_LEVEL_BATCH_WARNING = 0.6
/** Word-count spread between the longest and shortest option. */
export const WORD_COUNT_SPREAD_WARNING = 2
/** Minimum characters of feedback before it counts as meaningful. */
export const MIN_FEEDBACK_CHARACTERS = 30
/** Position distribution is only informative once the batch is this large. */
export const MIN_BATCH_FOR_POSITION_CHECK = 8

const BANNED_ALL_OF_THE_ABOVE = [
  'vsechny uvedene moznosti',
  'vsechny vyse uvedene',
  'vsechny predchozi moznosti',
  'vse uvedene',
]
const BANNED_NONE_OF_THE_ABOVE = [
  'zadna z uvedenych moznosti',
  'zadna z vyse uvedenych',
  'zadna z predchozich moznosti',
  'nic z uvedeneho',
]

/** Czech function words carry no discriminating information for overlap scoring. */
const STOP_WORDS = new Set(
  (
    'a i o u v z k s se si je jsou byl byla bylo byt ze na do od po pro pri za nad pod bez ' +
    'ale nebo protoze kdyz aby jak co kdo ktery ktera ktere kterou jeho jeji jejich ten ta to ' +
    'tento tato toto tim tomu te ty ti tak take jen jeste uz nez vice mene velmi sam sama ' +
    'ma mit mel mela melo bude budou neni nema jde slo jako vsak proto tedy pak zde tam'
  ).split(' '),
)

export function normaliseText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

function contentWords(text: string): Set<string> {
  return new Set(
    normaliseText(text)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  )
}

function overlapCount(stem: Set<string>, option: Set<string>): number {
  let count = 0
  for (const word of option) if (stem.has(word)) count += 1
  return count
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/** Coarse structural signature used to detect grammatical cueing. */
function structureSignature(text: string): string {
  const normalised = normaliseText(text)
  const hasSubordinate = /,\s*(protoze|ktery|ktera|ktere|kterou|jehoz|jenz|kdyz|aby|takze)\b/.test(
    normalised,
  )
  const isQuestionLike = normalised.trim().endsWith('?')
  const startsWithVerbPhrase = /^(je|jsou|byva|znamena|vede|zvysuje|snizuje|popisuje)\b/.test(
    normalised,
  )
  return `${hasSubordinate ? 'sub' : 'flat'}|${isQuestionLike ? 'q' : 's'}|${startsWithVerbPhrase ? 'v' : 'n'}`
}

export interface OptionStats {
  id: string
  characters: number
  words: number
  isCorrect: boolean
  stemOverlap: number
  structure: string
}

export interface QuestionAnalysis {
  questionId: string
  lessonId: string
  blockId: string
  file: string
  optionCount: number
  options: OptionStats[]
  correctCharacters: number
  correctWords: number
  medianDistractorCharacters: number
  medianDistractorWords: number
  /** correct length ÷ median distractor length. */
  lengthRatio: number
  correctIsLongest: boolean
  wordCountSpread: number
  stemOverlapCorrect: number
  maxStemOverlapDistractor: number
  /** True when the correct option shares clearly more stem vocabulary than any distractor. */
  lexicalOverlapSuspicious: boolean
  /** True when the correct option is the only option with its structural signature. */
  structuralOddOneOut: boolean
  negative: boolean
  cognitiveLevel: string
  hasLengthBiasJustification: boolean
  /** 0-based index of the correct option after a seeded, reproducible shuffle. */
  deterministicCorrectPosition: number
}

export type FindingLevel = 'error' | 'warning'

export interface AuditFinding {
  level: FindingLevel
  /** Stable rule identifier, e.g. `length-bias-hard`. */
  rule: string
  /** `null` for batch-level findings. */
  questionId: string | null
  file: string | null
  message: string
}

export interface BatchStats {
  questionCount: number
  longestCorrectCount: number
  longestCorrectRatio: number
  negativeCount: number
  negativeRatio: number
  recallLevelCount: number
  recallLevelRatio: number
  /** Counts of the deterministic correct-answer position, index 0..maxOptions-1. */
  positionDistribution: number[]
}

export interface AuditResult {
  analyses: QuestionAnalysis[]
  batch: BatchStats
  findings: AuditFinding[]
  errorCount: number
  warningCount: number
}

export function analyseQuestion(question: AuditableQuestion): QuestionAnalysis {
  const stem = contentWords(question.prompt)
  const options: OptionStats[] = question.options.map((option) => ({
    id: option.id,
    characters: option.text.trim().length,
    words: countWords(option.text),
    isCorrect: option.id === question.correctOptionId,
    stemOverlap: overlapCount(stem, contentWords(option.text)),
    structure: structureSignature(option.text),
  }))

  const correct = options.find((option) => option.isCorrect)
  const distractors = options.filter((option) => !option.isCorrect)
  const correctCharacters = correct?.characters ?? 0
  const medianDistractorCharacters = median(distractors.map((option) => option.characters))
  const wordCounts = options.map((option) => option.words)
  const minWords = Math.min(...wordCounts)

  const correctStructure = correct?.structure ?? ''
  const structuralOddOneOut =
    distractors.length > 1 && distractors.every((option) => option.structure !== correctStructure)

  const maxStemOverlapDistractor = distractors.reduce(
    (max, option) => Math.max(max, option.stemOverlap),
    0,
  )
  const stemOverlapCorrect = correct?.stemOverlap ?? 0

  const order = seededShuffle(
    question.options.map((option) => option.id),
    hashSeed(question.id),
  )

  return {
    questionId: question.id,
    lessonId: question.lessonId,
    blockId: question.blockId,
    file: question.file,
    optionCount: options.length,
    options,
    correctCharacters,
    correctWords: correct?.words ?? 0,
    medianDistractorCharacters,
    medianDistractorWords: median(distractors.map((option) => option.words)),
    lengthRatio:
      medianDistractorCharacters === 0 ? 0 : correctCharacters / medianDistractorCharacters,
    correctIsLongest: options.every(
      (option) => option.isCorrect || option.characters < correctCharacters,
    ),
    wordCountSpread: minWords === 0 ? 0 : Math.max(...wordCounts) / minWords,
    stemOverlapCorrect,
    maxStemOverlapDistractor,
    lexicalOverlapSuspicious: stemOverlapCorrect >= maxStemOverlapDistractor + 2,
    structuralOddOneOut,
    negative: question.negative,
    cognitiveLevel: question.cognitiveLevel,
    hasLengthBiasJustification:
      question.lengthBiasJustification !== undefined && question.lengthBiasJustification !== '',
    deterministicCorrectPosition: order.indexOf(question.correctOptionId),
  }
}

function checkBannedPhrases(question: AuditableQuestion, findings: AuditFinding[]): void {
  for (const option of question.options) {
    const normalised = normaliseText(option.text)
    if (BANNED_ALL_OF_THE_ABOVE.some((phrase) => normalised.includes(phrase))) {
      findings.push({
        level: 'error',
        rule: 'all-of-the-above',
        questionId: question.id,
        file: question.file,
        message: `možnost „${option.id}“ používá zakázanou formulaci typu „všechny uvedené možnosti“`,
      })
    }
    if (BANNED_NONE_OF_THE_ABOVE.some((phrase) => normalised.includes(phrase))) {
      findings.push({
        level: 'error',
        rule: 'none-of-the-above',
        questionId: question.id,
        file: question.file,
        message: `možnost „${option.id}“ používá zakázanou formulaci typu „žádná z uvedených možností“`,
      })
    }
  }
}

function checkFeedback(question: AuditableQuestion, findings: AuditFinding[]): void {
  const seen = new Map<string, string>()
  for (const option of question.options) {
    const feedback = option.feedback.trim()
    if (feedback.length < MIN_FEEDBACK_CHARACTERS) {
      findings.push({
        level: 'error',
        rule: 'feedback-too-short',
        questionId: question.id,
        file: question.file,
        message:
          `zpětná vazba u možnosti „${option.id}“ má ${feedback.length} znaků; ` +
          `každý distraktor musí vysvětlit konkrétní omyl (minimum ${MIN_FEEDBACK_CHARACTERS})`,
      })
    }
    const previous = seen.get(normaliseText(feedback))
    if (previous !== undefined) {
      findings.push({
        level: 'error',
        rule: 'feedback-duplicated',
        questionId: question.id,
        file: question.file,
        message: `možnosti „${previous}“ a „${option.id}“ mají shodnou zpětnou vazbu`,
      })
    }
    seen.set(normaliseText(feedback), option.id)
  }
}

function checkNegation(question: AuditableQuestion, findings: AuditFinding[]): void {
  const looksNegative = /\bNE[A-ZÁ-Ž]*\b/.test(question.prompt) || /\bneplatí\b/i.test(question.prompt)
  if (looksNegative && !question.negative) {
    findings.push({
      level: 'error',
      rule: 'negation-undeclared',
      questionId: question.id,
      file: question.file,
      message: 'zadání je zjevně negativní, ale otázka nemá nastaveno "negative": true',
    })
  }
  if (question.negative && !/\bNE[A-ZÁ-Ž]*\b/.test(question.prompt)) {
    findings.push({
      level: 'error',
      rule: 'negation-not-emphasised',
      questionId: question.id,
      file: question.file,
      message: 'negativní otázka musí mít v zadání zvýrazněné velké NE, aby ho nešlo přehlédnout',
    })
  }
}

export function auditQuestions(questions: readonly AuditableQuestion[]): AuditResult {
  const findings: AuditFinding[] = []
  const analyses = questions.map(analyseQuestion)

  for (const question of questions) {
    checkBannedPhrases(question, findings)
    checkFeedback(question, findings)
    checkNegation(question, findings)
  }

  for (const analysis of analyses) {
    if (analysis.lengthRatio > LENGTH_RATIO_HARD_FAIL && !analysis.hasLengthBiasJustification) {
      findings.push({
        level: 'error',
        rule: 'length-bias-hard',
        questionId: analysis.questionId,
        file: analysis.file,
        message:
          `správná možnost je ${analysis.lengthRatio.toFixed(2)}× delší než medián distraktorů ` +
          `(limit ${LENGTH_RATIO_HARD_FAIL}); zkraťte ji, prodlužte distraktory, ` +
          'nebo doplňte pole lengthBiasJustification',
      })
    } else if (analysis.lengthRatio > LENGTH_RATIO_WARNING) {
      findings.push({
        level: 'warning',
        rule: 'length-bias-soft',
        questionId: analysis.questionId,
        file: analysis.file,
        message: `správná možnost je ${analysis.lengthRatio.toFixed(2)}× delší než medián distraktorů (doporučené maximum ${LENGTH_RATIO_WARNING})`,
      })
    }

    if (analysis.wordCountSpread > WORD_COUNT_SPREAD_WARNING) {
      findings.push({
        level: 'warning',
        rule: 'structure-word-spread',
        questionId: analysis.questionId,
        file: analysis.file,
        message: `nejdelší možnost má ${analysis.wordCountSpread.toFixed(2)}× více slov než nejkratší; možnosti mají mít srovnatelnou stavbu`,
      })
    }

    if (analysis.structuralOddOneOut) {
      findings.push({
        level: 'warning',
        rule: 'structure-odd-one-out',
        questionId: analysis.questionId,
        file: analysis.file,
        message:
          'správná možnost je jediná se svou větnou stavbou — gramatická stavba se stává vodítkem',
      })
    }

    if (analysis.lexicalOverlapSuspicious) {
      findings.push({
        level: 'warning',
        rule: 'lexical-overlap',
        questionId: analysis.questionId,
        file: analysis.file,
        message:
          `správná možnost sdílí se zadáním ${analysis.stemOverlapCorrect} významových slov, ` +
          `nejlepší distraktor jen ${analysis.maxStemOverlapDistractor}; slovní shoda prozrazuje odpověď`,
      })
    }
  }

  const questionCount = analyses.length
  const longestCorrectCount = analyses.filter((analysis) => analysis.correctIsLongest).length
  const negativeCount = analyses.filter((analysis) => analysis.negative).length
  const recallLevelCount = analyses.filter((analysis) => analysis.cognitiveLevel === 'recall').length
  const maxOptions = analyses.reduce((max, analysis) => Math.max(max, analysis.optionCount), 0)
  const positionDistribution = Array.from({ length: maxOptions }, () => 0)
  for (const analysis of analyses) {
    const position = analysis.deterministicCorrectPosition
    if (position >= 0) positionDistribution[position] = (positionDistribution[position] ?? 0) + 1
  }

  const longestCorrectRatio = questionCount === 0 ? 0 : longestCorrectCount / questionCount
  const negativeRatio = questionCount === 0 ? 0 : negativeCount / questionCount
  const recallLevelRatio = questionCount === 0 ? 0 : recallLevelCount / questionCount

  if (longestCorrectRatio > LONGEST_CORRECT_BATCH_FAIL) {
    findings.push({
      level: 'error',
      rule: 'batch-longest-correct',
      questionId: null,
      file: null,
      message: `správná možnost je nejdelší u ${(longestCorrectRatio * 100).toFixed(0)} % otázek (limit ${(LONGEST_CORRECT_BATCH_FAIL * 100).toFixed(0)} %)`,
    })
  } else if (longestCorrectRatio > LONGEST_CORRECT_BATCH_WARNING) {
    findings.push({
      level: 'warning',
      rule: 'batch-longest-correct',
      questionId: null,
      file: null,
      message: `správná možnost je nejdelší u ${(longestCorrectRatio * 100).toFixed(0)} % otázek (doporučené maximum ${(LONGEST_CORRECT_BATCH_WARNING * 100).toFixed(0)} %)`,
    })
  }

  if (negativeRatio > NEGATIVE_QUESTION_BATCH_WARNING) {
    findings.push({
      level: 'warning',
      rule: 'batch-negative-questions',
      questionId: null,
      file: null,
      message: `negativních otázek je ${(negativeRatio * 100).toFixed(0)} %; mají zůstat výjimkou`,
    })
  }

  if (recallLevelRatio > RECALL_LEVEL_BATCH_WARNING) {
    findings.push({
      level: 'warning',
      rule: 'batch-cognitive-level',
      questionId: null,
      file: null,
      message: `${(recallLevelRatio * 100).toFixed(0)} % otázek je na úrovni pouhého vybavení; převažovat mají mechanismus a transfer`,
    })
  }

  if (questionCount >= MIN_BATCH_FOR_POSITION_CHECK && maxOptions > 0) {
    const expected = questionCount / maxOptions
    positionDistribution.forEach((count, index) => {
      if (count > expected * 1.75) {
        findings.push({
          level: 'warning',
          rule: 'batch-position-bias',
          questionId: null,
          file: null,
          message: `po deterministickém zamíchání připadá na pozici ${index + 1} ${count} z ${questionCount} správných odpovědí`,
        })
      }
    })
  }

  return {
    analyses,
    batch: {
      questionCount,
      longestCorrectCount,
      longestCorrectRatio,
      negativeCount,
      negativeRatio,
      recallLevelCount,
      recallLevelRatio,
      positionDistribution,
    },
    findings,
    errorCount: findings.filter((finding) => finding.level === 'error').length,
    warningCount: findings.filter((finding) => finding.level === 'warning').length,
  }
}
