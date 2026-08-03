# Content authoring

How to add and change course content. Engineering documentation is English; **everything
you write into the JSON files is Czech**, because it is shown to the learner.

## Golden rule

Lesson content never goes into a React component. If you find yourself writing Czech
prose inside `.tsx`, stop — it belongs in `src/content/`.

## Files

```
src/content/
├── course.json          modules and their lesson order
├── concepts.json        the concepts lessons and review items are tagged with
├── sources.json         every citable source, with a verified DOI
├── lessons/<id>.json    one file per lesson; the filename should match the lesson id
├── schema.ts            Zod schema — the authoritative definition
├── validation.ts        cross-file rules (unique IDs, references, time ranges)
└── loader.ts            the only entry point the application reads content through
```

## Lesson schema

```ts
type Lesson = {
  id: string                              // kebab-case, unique across the course
  version: number                         // bump on any substantive change
  status: 'demo' | 'draft' | 'reviewed' | 'published'
  title: string
  summary: string
  estimatedActiveMinutes: number
  minimumReasonableActiveMinutes: number  // ≤ estimated
  maximumReasonableActiveMinutes: number  // ≥ estimated
  prerequisiteLessonIds: string[]
  conceptIds: string[]                    // must exist in concepts.json
  learningObjectives: string[]
  sourceIds: string[]                     // must exist in sources.json
  demoNotice?: string                     // required on demo lessons, forbidden elsewhere
  blocks: LessonBlock[]
}
```

Every block carries `id`, `type`, `title`, `estimatedMinutes`, `conceptIds`, `sourceIds`
plus its own fields. Block IDs are unique within a lesson; question IDs are unique across
the entire course.

Objects are **strict**: an unknown key fails validation. That is deliberate — a typo like
`estimatedMinuts` should not be silently ignored.

## Content statuses

| Status | Meaning | Extra rules |
| --- | --- | --- |
| `demo` | Architecture demo, not audited | must carry the exact Czech `demoNotice`; shown with a banner and a badge |
| `draft` | Being written | no source requirement yet |
| `reviewed` | Content-reviewed | must cite ≥ 1 source; every `explanation` block must cite a source |
| `published` | Released | same as `reviewed`; treat as frozen — bump `version` on any change |

The demo notice must be exactly:

```
Ukázková lekce pro ověření aplikace. Nejde ještě o finální odborně auditovanou verzi kurzu.
```

## Block types

Implemented today:

| Type | Purpose | Key fields |
| --- | --- | --- |
| `explanation` | Structured Czech exposition | `paragraphs`, optional `keyPrinciple` („Klíčový princip“), `commonMistake` („Pozor na omyl“), optional `model` table with a mandatory `caveat` |
| `prediction` | Commit to an outcome before learning | `question.options`, `question.reveal`, optional `correctOptionId` |
| `multiple_choice` | Discrimination / mechanism check | `question` with `options`, `correctOptionId`, `explanation`, `cognitiveLevel` |
| `scenario` | Apply the concept to a new case | `situation` + the same question shape as `multiple_choice` |
| `free_recall` | Retrieval, self-rated | `question.modelAnswer`, `question.requiredElements`, optional `explanation` |
| `personal_transfer` | Apply to the learner's own behaviour | `prompt`, `guidance`, `placeholder`, `minimumCharacters` |
| `summary` | Close the loop | `mainMechanism`, `distinctions`, `commonMisconception`, `nextTopic` |

Planned and already accounted for by the architecture: `sorting`, `matching`,
`interactive_simulation`, `diagram`, `confidence_calibration`, `delayed_review`.

Adding one is three steps:

1. add a variant to `lessonBlockSchema` in `src/content/schema.ts`;
2. write the renderer in `src/components/blocks/`;
3. add the case to the `switch` in `BlockRenderer.tsx` and a label in `blockLabels.ts`.

The switch is exhaustive, so TypeScript tells you if you forget step 3.

## Adding a lesson

1. Create `src/content/lessons/<id>.json`.
2. Add `<id>` to a module's `lessonIds` in `course.json` (otherwise validation warns that
   the lesson will not appear in the course map).
3. Make sure every `conceptIds` entry exists in `concepts.json` and every `sourceIds`
   entry exists in `sources.json`.
4. Check the time budget: the sum of `estimatedMinutes` across blocks must fall between
   `minimumReasonableActiveMinutes` and `maximumReasonableActiveMinutes`. Validation
   enforces this — an honest estimate is not optional.
5. Include at least one retrieval activity. A lesson made only of explanations fails
   validation.
6. Run `npm run content:validate` and `npm run content:audit-mcq`.

## Adding a concept

```json
{
  "id": "reward-prediction-error",
  "name": "Chyba predikce odměny",
  "shortDefinition": "Rozdíl mezi očekávaným a skutečným výsledkem…",
  "commonMisconception": "Že chyba predikce je jen jiné označení pro odměnu."
}
```

`commonMisconception` is optional but valuable: it is the raw material for a plausible
distractor.

## Adding a source

**Never invent a citation and never invent a DOI.** Verify first:

```bash
curl -s https://api.crossref.org/works/10.1126/science.275.5306.1593
```

Then add it, copying the metadata exactly:

```json
{
  "id": "schultz-1997",
  "type": "journal-article",
  "authors": ["Schultz, W.", "Dayan, P.", "Montague, P. R."],
  "year": 1997,
  "title": "A Neural Substrate of Prediction and Reward",
  "container": "Science, 275(5306), 1593–1599",
  "doi": "10.1126/science.275.5306.1593",
  "note": "Popisuje aktivitu dopaminergních neuronů u primátů, nikoli přímý popis lidské motivace."
}
```

Use `note` to record what the source does **and does not** support. It is shown to the
learner under the citation and it stops a source from drifting into claims it never made.

## Writing good questions

The full rules and the audit thresholds are in
[QUESTION_QUALITY.md](QUESTION_QUALITY.md). While drafting:

* Write the distractors first, from real misconceptions, then write the correct option to
  match their length and structure.
* Keep option lengths within roughly ±20 % of each other.
* Give every option feedback that explains *why* — at least 30 characters, and different
  for each option.
* Set `cognitiveLevel` honestly: `recall`, `discrimination`, `mechanism` or `transfer`.
  Recognition questions should be the minority.
* Negative stems are a last resort. If you use one, set `"negative": true` and write the
  negation in capitals (`NEPLATÍ`) so the UI can emphasise it.

## Running validation

```bash
npm run content:validate    # structure, references, uniqueness, time ranges
npm run content:audit-mcq   # length, position, structure and lexical cues
npm run check               # everything, including tests and the production build
```

Both scripts exit non-zero on failure and name the file, the object ID, the field and the
reason:

```
✖ Obsah kurzu je neplatný:
  src/content/lessons/demo-rpe.json [demo-rpe] → sourceIds: zdroj „schultz-1998“ není definován v sources.json
```

In development an invalid bundle throws with the full report. In production the learner
sees a Czech content-error screen listing file, object and field — never a stack trace.
