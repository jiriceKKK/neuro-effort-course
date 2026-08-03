# Implementation report

Technical foundation for the Czech learning application
**„Neurokognitivní psychologie úsilí, motivace a změny chování“**.

Date: 2026-08-03 · Branch: `main` · Repository: `jiriceKKK/neuro-effort-course`

---

## 1. Verification results

Every gate below was run on the final tree.

| Gate | Command | Result |
| --- | --- | --- |
| ESLint | `npm run lint` | **pass** — 0 errors, 0 warnings |
| Type check | `npm run typecheck` | **pass** — 0 errors across app, node tooling and tests |
| Content validation | `npm run content:validate` | **pass** — 2 modules, 2 lessons, 12 concepts, 7 sources, 9 questions |
| MCQ bias audit | `npm run content:audit-mcq` | **pass** — 5 questions, 0 errors, 0 warnings |
| Unit + integration tests | `npm run test:run` | **pass** — 156/156 in 11 files |
| Production build | `npm run build` | **pass** — `dist/` with manifest and service worker |
| End-to-end | `npm run test:e2e` | **pass** — 3/3 on a phone viewport against the production bundle |
| Combined gate | `npm run check` | **pass** |

Audit detail (all five multiple-choice items):

```
otázek:                           5
správná je nejdelší:              2 (40 %)   limit 55 %, doporučení 40 %
negativní zadání:                 0 (0 %)
pouhé vybavení (recall):          0 (0 %)
rozdělení pozic správné odpovědi: 1:3  2:0  3:1  4:1
```

Build output:

```
dist/manifest.webmanifest                        0.64 kB
dist/index.html                                  1.26 kB │ gzip:   0.60 kB
dist/assets/index-*.css                          9.65 kB │ gzip:   2.52 kB
dist/assets/workbox-window.prod.es5-*.js         5.65 kB │ gzip:   2.20 kB
dist/assets/index-*.js                         726.61 kB │ gzip: 212.75 kB
PWA precache 18 entries (737.97 KiB) — dist/sw.js, dist/workbox-*.js
```

Local preview of the production build (`npm run preview`, base
`/neuro-effort-course/`) returned HTTP 200 for `/`, `manifest.webmanifest`,
`sw.js`, `icons/icon-192.png`, `icons/apple-touch-icon.png` and `offline.html`.

### Security verification

```bash
git grep -n -E "service_role|sb_secret_|SUPABASE_SECRET|DATABASE_URL|postgresql://"
```

11 matches, **all of them documentation warning against these values**
(`.env.example`, `CLAUDE.md`, `README.md`, `docs/*`, `src/lib/supabase/config.ts`,
`src/vite-env.d.ts`, the deploy workflow, and the RLS test that asserts their absence).
No real secret value is committed anywhere.

* `.env.local` is listed in `.gitignore` (line 9) and confirmed untracked via
  `git check-ignore -v`.
* No `service_role` key, no `sb_secret_…` key, no database password, no connection
  string.
* The browser uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

---

## 2. Implemented

### Architecture and build
* React 19 + TypeScript strict + Vite, four-layer separation (content / engine / learner
  state / deployment), no `any` anywhere in the source.
* ESLint flat config with `typescript-eslint` and the React Compiler hook rules; all
  purity, ref and memoization rules satisfied rather than suppressed.
* Three TypeScript projects so Node types are available to the tooling and tests but
  cannot leak `process` into the browser bundle.
* GitHub Pages base path resolved at build time from `VITE_BASE_PATH` →
  `GITHUB_REPOSITORY` → `git remote` → `/`; the GitHub user name is never hardcoded.
* `HashRouter`, so every deep link survives a refresh under a repository subpath.

### Course content (layer A)
* Zod schema for course, modules, concepts, sources, lessons and all seven block types,
  with strict objects so a typo fails rather than being ignored.
* Cross-file validation: unique lesson/question/block IDs, resolvable source, concept and
  prerequisite references, self-prerequisite detection, `correctOptionId` resolution,
  duplicate option IDs, demo-notice exactness, sources required on `reviewed`/`published`,
  a mandatory retrieval activity per lesson, and block estimates that must sum inside the
  lesson's own declared time range.
* Shared by the browser loader, the test suite and the CLI — the CLI cannot pass while
  the app fails.
* `scripts/validate-content.ts` exits non-zero and names file, object, field and reason.

### Engine (layer B)
* Seven block renderers: `explanation` (with „Klíčový princip“, „Pozor na omyl“ and an
  optional model table with a mandatory caveat), `prediction`, `multiple_choice`,
  `scenario`, `free_recall`, `personal_transfer`, `summary`.
* Registry via an exhaustive `switch`: a new schema variant without a renderer is a
  compile error.
* Multiple choice: shuffled per attempt, order persisted with the attempt draft, nothing
  revealed until both an option and a confidence value are supplied, per-option feedback,
  citations, correctness by option ID.
* Free recall: explicit „Nevím“, confidence before reveal, model answer plus a required-
  elements checklist, then four Czech self-rating buttons. No automatic grading, no AI.
* `ActiveTimeTracker`: Page Visibility API, 75 s idle cutoff, network-wait suspension,
  monotonic clock, injectable for tests; idle time recorded rather than discarded.
* Review scheduler: Fail/Hard/Good/Easy → 1/1/3/7 days, then ×1.2/×2/×3 with a 60-day cap
  and a reset to 1 day on Fail; failed items re-queue within the session; keyed on stable
  item IDs.
* Dashboard priority: critically overdue review → due review → unfinished lesson → new
  lesson. No streak anywhere.
* MCQ bias analysis shared by the audit CLI and the unit tests.

### Learner state (layer C)
* Dexie database with `lessonProgress`, `learnerEvents`, `questionAttempts`,
  `reviewState`, `personalNotes`, `userSettings`, plus local-only `attemptDrafts`,
  `outbox` and `meta` (persistent device ID).
* Local write and outbox row in one transaction; upserts collapse, append-only inserts
  never do.
* Sync engine: statuses `pending | syncing | synced | failed`, bounded exponential
  backoff (5 s → 5 min, six attempts), triggers on start, login, `online`, local write
  and the manual button; never deletes unsynced local data on failure.
* Idempotency: UUID-keyed `ON CONFLICT DO NOTHING` inserts; natural-key upserts;
  last-write-wins on `updated_at` enforced by a database trigger.
* Signed-out work is re-owned on login rather than discarded.
* Czech status labels throughout.

### Supabase and security (layer D)
* `supabase/migrations/0001_initial_learning_schema.sql`: six tables with the exact
  required fields, constraints, indexes and a shared timestamp trigger.
* RLS enabled **and forced** on all six tables; every privilege revoked from `anon`;
  `authenticated`-only policies scoped by `user_id = (select auth.uid())`; `WITH CHECK`
  on every INSERT and UPDATE; no UPDATE privilege at all on the append-only tables.
* No `SECURITY DEFINER` function; the one trigger function is `SECURITY INVOKER` with
  `search_path = ''`.
* Email + password auth, persisted sessions, `onAuthStateChange`, protected routes with
  a distinct initialising state, Czech error translations, signup gated behind
  `VITE_ALLOW_SIGNUP` (default `false`).
* Single client instance; a Czech configuration screen when the two variables are absent.

### User interface (all Czech)
Login, Dashboard, Course map, Lesson runner, Review, Progress, Settings & data.
Mobile-first CSS with design tokens, semantic HTML, keyboard navigation, visible focus
rings, ≥44 px touch targets, `prefers-reduced-motion`, ARIA live regions with focus
management after answer submission, text markers so correctness is never colour-only,
accessible progress information, and confirmation dialogs that state exactly what will be
deleted.

### PWA and deployment
Czech manifest with relative `start_url`/`scope`, locally generated 192/512/maskable and
Apple touch icons, app-shell + content precaching, Supabase requests explicitly
NetworkOnly, an offline fallback page, and a Czech update prompt in `prompt` mode so an
update never reloads a lesson mid-answer.
GitHub Actions workflow: push to `main` + `workflow_dispatch`, Node 22, `npm ci`,
`npm run check`, build, `upload-pages-artifact@v3`, `deploy-pages@v4`, correct permissions,
`github-pages` environment, safe concurrency.

### Content
Two Czech demo lessons, both carrying the approved demo banner:

| Lesson | Blocks | Estimate | Range | Sum of block estimates |
| --- | --- | --- | --- | --- |
| `demo-evidence` — Jak poznat silnější psychologický důkaz | 7 | 9 min | 8–10 | 9 min |
| `demo-rpe` — Reward prediction error není samotná odměna | 9 | 11 min | 10–12 | 11 min |

`demo-evidence` covers anecdote → correlational study → randomized experiment →
systematic review → meta-analysis, and explicitly refuses the claim that a meta-analysis
is automatically the best evidence.

`demo-rpe` stays on conservative ground: prediction error as the difference between
expectation and outcome, positive/negative/near-zero cases, the model's limits, and no
dopamine-detox, depletion or reset claims. Dopamine is described as tracking a deviation
signal, not pleasure.

### Verified citations

All seven sources were checked against the Crossref API before being written into
`sources.json`; none were invented.

| ID | DOI | Verified |
| --- | --- | --- |
| `schultz-1997` | `10.1126/science.275.5306.1593` | yes |
| `pessiglione-2006` | `10.1038/nature05051` | yes |
| `prisma-2020` | `10.1136/bmj.n71` | yes |
| `rob2-2019` | `10.1136/bmj.l4898` | yes |
| `higgins-2003` | `10.1136/bmj.327.7414.557` | yes |
| `ioannidis-2016` | `10.1111/1468-0009.12210` | yes |
| `osc-2015` | `10.1126/science.aac4716` | yes |

---

## 3. Not implemented (by design)

Out of scope per the brief: the full twenty-lesson course, an AI tutor, AI grading,
social features, leaderboards, streaks, payments, public profiles, backend-dependent
notifications, Supabase Edge Functions, full FSRS, complex analytics dashboards, an admin
content editor, a CMS, and App Store / Google Play packaging.

Also deliberately absent for this version:

* **Sync is push-only.** A fresh device starts empty and uploads what it produces; it
  does not pull existing cloud rows. This is the single most important next feature and
  the engine has a clean place for a `pull()` phase.
* The additional block types (`sorting`, `matching`, `interactive_simulation`, `diagram`,
  `confidence_calibration`, `delayed_review`) are accounted for architecturally but not
  built.
* Concept mastery is accuracy plus a confidence-versus-accuracy gap, not a model.

---

## 4. Dependencies added

| Package | Why |
| --- | --- |
| `react`, `react-dom` | Required stack |
| `react-router-dom` | Required; used with `HashRouter` for GitHub Pages |
| `@supabase/supabase-js` | Required; auth and cloud persistence |
| `dexie` | Required; the lightweight IndexedDB abstraction named in the brief |
| `zod` | Required; runtime content validation |
| `vite`, `@vitejs/plugin-react`, `typescript` | Required build toolchain |
| `vite-plugin-pwa` | Required; manifest, service worker, update prompt |
| `vitest`, `jsdom` | Required test runner and DOM environment |
| `@testing-library/{react,dom,jest-dom,user-event}` | Required component testing |
| `fake-indexeddb` | Real Dexie round-trips in tests without a browser |
| `@playwright/test` | Required end-to-end testing |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals` | Required linting |
| `tsx` | Runs the TypeScript CLIs without a separate build step |
| `@types/{node,react,react-dom}` | Type definitions |

No UI framework, no CSS framework, no state-management library. Styling is plain CSS with
design tokens.

Two npm advisories are reported at `high` severity in the transitive dev-dependency tree.
They affect build/test tooling only, not the shipped bundle, and `npm audit fix --force`
would downgrade or replace major versions of the build toolchain, so they were left
alone deliberately rather than silently.

---

## 5. Known limitations

1. **Push-only sync** (see above) — the most significant gap.
2. **Single 727 kB JS chunk** (213 kB gzipped). Acceptable for a precached PWA, but
   route-level code splitting is the obvious next optimisation; the build prints the
   warning rather than hiding it behind a raised threshold.
3. **The prototype scheduler is not FSRS.** Intervals are deliberately simple and
   inspectable; the state shape already fits a real model.
4. **Free recall is self-rated.** Honest for retrieval practice, but self-rating is noisy.
5. **Service-worker behaviour is only covered end-to-end**, not in unit tests, because
   jsdom has no service worker.
6. **Batch-level MCQ rules need a batch.** With five questions the position-distribution
   check stays silent by design (it needs eight), and the "longest correct" ratio is
   noisy at this sample size.
7. **The two demo lessons are not content-audited.** They are labelled as such in the
   app, in `course.json` and in every place the lessons are listed.
8. **RLS is verified statically plus by a documented manual procedure**, not by an
   automated test against a live project — that would require credentials this repository
   deliberately does not hold.

---

## 6. Remaining manual steps

### Supabase Dashboard

1. Create a project (or open the existing one).
2. **SQL Editor → New query** → paste all of
   `supabase/migrations/0001_initial_learning_schema.sql` → **Run**.
   (Or `supabase link --project-ref <ref>` then `supabase db push`. This repository has
   not been linked, and no project reference, access token or database password was
   guessed.)
3. **Authentication → Users → Add user → Create new user**; tick **Auto Confirm User**.
4. **Project Settings → API**: copy the project URL and the **publishable/anon** key.
   Never the service-role key.
5. Run the verification queries in
   [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) §5, then the two-user isolation test
   in §6.

### GitHub repository settings

1. **Settings → Secrets and variables → Actions → Variables** → add:
   * `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   * `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…`
   * `VITE_ALLOW_SIGNUP` = `false` (optional)
2. **Settings → Pages → Build and deployment → Source** → **GitHub Actions**.
3. **Actions → Deploy to GitHub Pages → Run workflow** (or push to `main`).

### Expected deployment URL

```
https://<owner>.github.io/neuro-effort-course/
```

For this remote: `https://jiriceKKK.github.io/neuro-effort-course/`
Deep links use the hash, e.g. `…/neuro-effort-course/#/lekce/demo-rpe`.

---

## 7. Git

Branch `main`, seven logical commits plus this report:

| Hash | Commit |
| --- | --- |
| `870b5a6` | chore: scaffold application architecture |
| `c537fc2` | feat: add JSON course content layer with runtime validation |
| `a02897b` | feat: add Supabase auth and local-first persistence |
| `b33dfdb` | feat: add lesson engine and Czech demo lessons |
| `ab933bd` | feat: add PWA support and GitHub Pages deployment |
| `8b66800` | test: add unit, integration and end-to-end coverage |
| `150923e` | docs: add architecture, authoring, deployment and quality documentation |

No force push was used at any point.

Push result: see the final section, updated after `git push -u origin main`.
