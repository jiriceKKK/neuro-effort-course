# Question quality

A multiple-choice item is only worth asking if a learner who does not understand the
content cannot find the answer anyway. Most of the ways they *can* find it are surface
features of how the options were written, and most of those are measurable.

`npm run content:audit-mcq` measures them. The implementation is
`src/learning/questionQuality/mcqBias.ts`, shared by the CLI and the unit tests.

## The cues we guard against

### 1. Answer-length bias

The most common giveaway. Writers elaborate the correct option because they are thinking
about *being right*, and trim the distractors because they are thinking about *being
done*. Learners pick the longest option and score above chance without reading.

**Measure:** correct-option characters ÷ median distractor characters.

| Condition | Result |
| --- | --- |
| ratio > 1.6 without `lengthBiasJustification` | **hard failure** |
| ratio > 1.3 | warning |
| correct option is longest in > 55 % of the batch | **hard failure** |
| correct option is longest in > 40 % of the batch | warning |

`lengthBiasJustification` is an escape hatch, not a mute button: set it only when the
correct option genuinely cannot be shortened without losing accuracy, and write the
reason in the field. The audit still reports the ratio.

**Fix:** lengthen the distractors before you shorten the correct option. A distractor
padded with plausible detail is a better distractor.

### 2. Position bias

If the answer is disproportionately B or C, learners learn the pattern.

The application removes position as a signal entirely: options are shuffled per attempt,
the shuffled order is stored with the attempt draft (so a reload cannot reshuffle a
half-answered question), and the answer is stored and evaluated as an **option ID** —
never a letter, never an index.

The audit still reports the distribution after a deterministic seeded shuffle, and warns
when one position holds more than 1.75× its expected share. That check needs at least 8
questions to mean anything, so it stays silent below that.

### 3. Grammatical cueing

If the stem ends "…je proces, který" and only one option is a relative clause, the answer
is a grammar exercise. The same applies to word class: three noun phrases and one full
sentence points straight at the odd one out.

**Measure:** a coarse structural signature per option (subordinate clause present, verb-
initial, question-like), plus the word-count spread across options.

| Condition | Result |
| --- | --- |
| the correct option is the *only* option with its structural signature | warning |
| longest option has > 2× the words of the shortest | warning |

The rule targets the correct option specifically: an odd-one-out distractor narrows the
field a little, an odd-one-out *answer* gives the game away.

### 4. Lexical overlap with the stem

Repeating the stem's vocabulary in the correct option turns the item into a matching
exercise. This is easy to do accidentally when writing the answer directly from the
sentence you just taught.

**Measure:** count of shared content words (Czech function words excluded, diacritics
normalised) between the stem and each option.

| Condition | Result |
| --- | --- |
| correct option shares ≥ 2 more content words with the stem than the best distractor | warning |

**Fix:** paraphrase the correct option, or seed the same vocabulary into the distractors.

### 5. Implausible distractors

An option nobody would choose is not a distractor, it is filler. Three options where one
is obviously absurd is a two-option question wearing a four-option costume.

Plausibility cannot be measured directly, so the audit uses feedback as the proxy: if you
can write a specific explanation of *why someone would believe this*, the distractor
encodes a real misconception.

| Condition | Result |
| --- | --- |
| any option's feedback is shorter than 30 characters | **hard failure** |
| two options share the same feedback | **hard failure** |

`concepts.json` carries a `commonMisconception` field precisely so distractors have a
documented source.

### 6. Banned constructions

| Condition | Result |
| --- | --- |
| „všechny uvedené možnosti“ (or variants) | **hard failure** |
| „žádná z uvedených možností“ (or variants) | **hard failure** |

Both test test-taking strategy rather than understanding: recognising two correct options
is enough to pick "all of the above" without evaluating the third.

### 7. Negative stems

Negation is harder to process and a missed "NE" makes a knowledgeable learner answer
wrongly for a reason that has nothing to do with the content.

| Condition | Result |
| --- | --- |
| stem reads as negative but `"negative": true` is not set | **hard failure** |
| `"negative": true` but no capitalised `NE…` in the stem | **hard failure** |
| more than 20 % of the batch is negative | warning |

When `negative` is set, the runner renders the capitalised negation in bold so it cannot
be skimmed past.

## What the question is measuring

Every question declares a `cognitiveLevel`:

| Level | The learner must… | Example |
| --- | --- | --- |
| `recall` | reproduce a stated fact | "Co znamená zkratka RPE?" |
| `discrimination` | tell two similar things apart | "Co odlišuje chybu predikce odměny od odměny samotné?" |
| `mechanism` | predict what the model implies | "Student dostane přesně tu známku, se kterou počítal. Co model říká o velikosti signálu?" |
| `transfer` | apply the concept to a new case | a `scenario` block about a habit-tracking app |

`recall` items are cheap to write and cheap to pass. They belong in a minority.

| Condition | Result |
| --- | --- |
| more than 60 % of the batch is `recall` | warning |

Prefer `mechanism` and `transfer`: they are the levels that distinguish a learner who
understood from one who remembers the sentence.

## Data model rules

```ts
type MultipleChoiceOption = {
  id: string        // stable, kebab-case, unique within the question
  text: string
  feedback: string  // shown after submission, for this option specifically
}

// The question stores:
correctOptionId: string   // never an index, never 'A'
```

* Options are shuffled on every new attempt.
* The order is stable during a single attempt and survives a reload while the attempt is
  unfinished (`attemptDrafts` in IndexedDB).
* `question_attempts.selected_option_id` stores the option ID.
* Evaluation compares IDs. Tests assert that no shuffle can change which answer is
  correct.

## Running the audit

```bash
npm run content:audit-mcq
```

It prints per-question statistics — option lengths, word counts, the length ratio,
whether the correct option is longest, stem overlap and the deterministic position — then
batch statistics, then warnings and errors. It exits non-zero on any hard failure, and
`npm run check` runs it before the production build.

Warnings do not fail the build. They are still worth fixing: they are the cues that turn
into a hard failure once the batch grows.

## Checklist before committing a question

- [ ] Distractors written first, from real misconceptions.
- [ ] Option lengths within roughly ±20 % of one another.
- [ ] Same word class and comparable sentence structure across options.
- [ ] The correct option does not echo the stem more than the distractors do.
- [ ] Every option has specific feedback explaining why it is right or wrong.
- [ ] No "all/none of the above"; negation only if unavoidable and declared.
- [ ] `cognitiveLevel` set honestly.
- [ ] `npm run content:audit-mcq` passes with no new warnings.
