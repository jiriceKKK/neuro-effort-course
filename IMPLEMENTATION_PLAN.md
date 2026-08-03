# Implementation Plan

Technical foundation for the Czech learning application
**„Neurokognitivní psychologie úsilí, motivace a změny chování“**.

This document is engineering documentation and is written in English.
All learner-facing strings produced by this plan are Czech.

## 0. Repository baseline (observed)

| Fact | Value |
| --- | --- |
| Branch | `main` (no commits yet) |
| Remote | `https://github.com/jiriceKKK/neuro-effort-course.git` |
| Repository name | `neuro-effort-course` |
| Existing source | none |
| Package manager | npm 11.6.1 / Node v22.13.1 |
| Present untracked file | `.env.local` (must stay untracked) |

Consequence: nothing is overwritten, no destructive operation is required.
GitHub Pages production base path will be `/neuro-effort-course/`, derived at
build time — never hardcoded with the GitHub user name.

## 1. Scaffolding

1. `package.json`, `tsconfig.*.json` (strict), `vite.config.ts`, `eslint.config.js`,
   `vitest` setup, `.gitignore`, `.env.example`.
2. Dependencies: react, react-dom, react-router-dom, @supabase/supabase-js,
   dexie, zod.
   Dev: vite, @vitejs/plugin-react, typescript, typescript-eslint, vite-plugin-pwa,
   vitest, jsdom, @testing-library/{react,jest-dom,user-event}, fake-indexeddb,
   tsx, @playwright/test.
3. Scripts: `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:run`,
   `content:validate`, `content:audit-mcq`, `check`, `test:e2e`.

## 2. Layer A — course content (`src/content/`)

* `schema.ts` — Zod schemas for course, concept, source, lesson, 7 block types,
  MCQ options with stable IDs.
* `loader.ts` — single entry point; eager `import.meta.glob` of lesson JSON;
  cross-reference validation (unique lesson/question/block IDs, existing
  source/concept/prerequisite IDs, `correctOptionId` resolves, time-range
  consistency, sources required for `reviewed`/`published`, demo lessons flagged).
* Content JSON: `course.json`, `concepts.json`, `sources.json`,
  `lessons/demo-evidence.json`, `lessons/demo-rpe.json`.
* Failure behaviour: throw a typed `ContentValidationError` (file, object id,
  field, reason). Dev → surfaced verbatim; production → Czech content-error screen.

## 3. Layer B — engine (`src/components/`, `src/learning/`)

* Block renderers: explanation, multiple_choice, free_recall, prediction,
  scenario, personal_transfer, summary. Registry-based so new block types are a
  one-line addition.
* `learning/timing` — `ActiveTimeTracker`: Page Visibility API + 75 s idle cutoff,
  monotonic `performance.now()`, injectable clock for tests.
* `learning/scheduler` — transparent prototype scheduler (Fail/Hard/Good/Easy →
  1/1/3/7 d; then ×2 / ×3; Fail resets to 1 d; cap 60 d) keyed on `item_id`.
* `learning/mastery` — per-concept mastery aggregation + dashboard priority order.
* `learning/questionQuality` — seeded shuffle (stable per attempt) and the shared
  MCQ bias analyser used by both the audit script and the unit tests.

## 4. Layer C — learner state (`src/persistence/`)

* `local/` — Dexie database: `lessonProgress`, `learnerEvents`, `questionAttempts`,
  `reviewState`, `personalNotes`, `userSettings`, `outbox`, `meta` (device id).
  Every write is local-first and immediate.
* `remote/` — Supabase repository: append-only inserts for events/attempts
  (UUID PK ⇒ idempotent), upserts for state tables (last-write-wins on
  `updated_at`).
* `sync/` — outbox engine: statuses `pending|syncing|synced|failed`, bounded
  exponential retry, triggers (app start, login, `online`, new event, manual
  „Synchronizovat nyní“). Never deletes unsynced local data on remote failure.
* Czech status strings: `Synchronizováno`, `Offline`, `Čekající změny`,
  `Probíhá synchronizace`, `Chyba synchronizace`.

## 5. Layer D — deployment & config

* `src/lib/supabase/client.ts` — single client instance, persisted sessions,
  `onAuthStateChange`; missing config → Czech configuration-error screen.
* `supabase/migrations/0001_initial_learning_schema.sql` — six tables, RLS on all,
  `authenticated`-only policies scoped by `auth.uid()`, `WITH CHECK` on
  INSERT/UPDATE, indexes, shared `updated_at` trigger. No `SECURITY DEFINER`.
* `.github/workflows/deploy-pages.yml` — `npm ci` → `npm run check` → build →
  official Pages actions, repository *variables* for the two `VITE_*` values.
* `vite-plugin-pwa` — Czech manifest, locally generated icons, app-shell +
  content precache, Supabase requests explicitly not cached, Czech update prompt.

## 6. UI screens (Czech)

Login, Dashboard, Course map, Lesson runner, Review, Settings & data.
Mobile-first CSS with design tokens, no UI framework, `prefers-reduced-motion`,
visible focus rings, ≥44 px touch targets, ARIA live regions for answer feedback.

## 7. Content

Two demo lessons, both carrying the Czech demo banner
„Ukázková lekce pro ověření aplikace. Nejde ještě o finální odborně auditovanou
verzi kurzu.“

* `demo-evidence` — 8–10 active minutes, evidence hierarchy without overclaiming
  meta-analyses.
* `demo-rpe` — 10–12 active minutes, reward prediction error, sources limited to
  Schultz/Dayan/Montague (1997) and Pessiglione et al. (2006) with verified DOIs;
  no dopamine-detox claims.

## 8. Quality gates

`npm run check` = lint → typecheck → content validation → MCQ bias audit →
`vitest run` → production build. Tests cover every item listed in the brief
(content validation failures, shuffling, timing exclusions, scheduler, outbox
idempotency, auth guard, RLS SQL assertions) plus one full lesson
integration test with reload persistence.

## 9. Documentation & Git

`CLAUDE.md`, `README.md`, `docs/{ARCHITECTURE,CONTENT_AUTHORING,DEPLOYMENT,
SUPABASE_SETUP,TESTING,QUESTION_QUALITY}.md`, `IMPLEMENTATION_REPORT.md`.
Then logical commits and a normal (never forced) push to `origin main`.
