# CLAUDE.md

Instructions for any future Claude Code session working in this repository.
Read this before changing anything.

## Project purpose

An interactive Czech learning application about the **neurocognitive psychology of
effort, motivation, self-regulation, procrastination, habits and behaviour change**.

The current state is a technical foundation plus two demo lessons — not the finished
course. It is built so that batches of five reviewed lessons can be added later without
redesigning anything.

## Language rules (non-negotiable)

* **Everything the learner sees or hears is Czech**: navigation, buttons, headings,
  forms, auth screens, validation errors, sync messages, ARIA labels, confirmation
  dialogs, lesson content, questions, options, answer feedback, review controls,
  settings, empty states, demo banners, time estimates, PWA update prompts.
* **Code and engineering docs are English**: identifiers, types, functions, test names,
  code comments, commit messages, `docs/*`, this file.
* Never mix English UI labels into the Czech interface. Established technical names
  (`DOI`, `PWA`, `JSON`, `reward prediction error` as a term of art) may stay.
* Use correct Czech diacritics. Do not write machine-literal translations.

## Architecture

React · TypeScript (strict) · Vite · GitHub Pages · PWA · Supabase · IndexedDB.

Four layers, and they must not bleed into each other:

| Layer | Location | Rule |
| --- | --- | --- |
| A. Course content | `src/content/` | JSON only. Never in Supabase, never inside a component. |
| B. Engine | `src/components/`, `src/learning/` | Renders and schedules; knows nothing about a specific lesson. |
| C. Learner state | `src/persistence/` | Local-first: IndexedDB write, then outbox, then Supabase. |
| D. Deployment | `vite.config.ts`, `.github/`, `supabase/` | Base path, PWA, RLS migration. |

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scientific integrity

* **Never invent a citation and never invent a DOI.** Verify metadata (Crossref:
  `https://api.crossref.org/works/<doi>`) before adding a source.
* Do not confuse correlation with causation, in content or in wording.
* Do not describe dopamine as "the pleasure chemical" or as equivalent to motivation.
  No dopamine detox, no depletion, no "resetting dopamine".
* Do not name a single brain region as the seat of willpower.
* Label models as models. A teaching schema is not a neural implementation.
* Distinguish established findings from interpretation; avoid neuroscience overclaiming.
* Do not silently change lesson content that has been scientifically reviewed. Content
  with `status: 'reviewed'` or `'published'` changes only with an explicit request, and
  the `version` field goes up when it does.

## Question quality

Full rules: [docs/QUESTION_QUALITY.md](docs/QUESTION_QUALITY.md). The short version:

* The correct option must not be systematically the longest, the most detailed, or the
  most technical.
* No position bias: options are shuffled per attempt and answers are stored by **option
  ID**, never by letter or index.
* No grammatical cue: distractors share the correct option's word class and sentence
  shape.
* No lexical cue: the correct option must not echo the stem more than the distractors do.
* Every distractor encodes a realistic misconception, and every option has meaningful
  feedback.
* Never use „všechny uvedené možnosti“ or „žádná z uvedených možností“.
* Prefer mechanism and transfer questions over surface recognition.
* Run `npm run content:audit-mcq` after touching any question.

## Time integrity

* Never label a four-minute quiz as a thirty-minute lesson.
* No artificial minimum timers, no fake waiting screens, no progression blocked purely
  to inflate duration.
* Measure **active** time: exclude hidden tabs, exclude idle beyond 75 s, exclude time
  blocked on a long network request.
* Every lesson declares `estimatedActiveMinutes` plus a minimum/maximum range, and
  content validation enforces that the sum of block estimates falls inside that range.
* Use the recorded measurements to correct estimates rather than defending them.

## Engineering rules

* TypeScript strict mode. Avoid `any`; if it is genuinely unavoidable, add a comment
  saying why.
* Never put a service-role key, an `sb_secret_…` key or the database password in client
  code, in a `VITE_` variable, or in any committed file.
* Every user-data table has RLS enabled with `authenticated`-only, `auth.uid()`-scoped
  policies, and every INSERT/UPDATE policy has a matching `WITH CHECK`.
* Run `npm run check` after any significant change. It must pass before you report done.
* Never `git push --force`.
* Do not add dependencies without a concrete need; do not refactor unrelated code.
* Keep course content out of React components.
* Preserve backward compatibility of published content schemas where practical; a
  breaking schema change needs a lesson `version` bump and a migration note.

## Commands

```bash
npm run dev               # local development on /
npm run check             # lint → types → content → MCQ audit → tests → build
npm run content:validate  # course-content validation only
npm run content:audit-mcq # MCQ bias audit only
npm run test:run          # unit + integration tests
npm run test:e2e          # Playwright, against the production bundle
npm run build && npm run preview
```
