# Testing

## Commands

```bash
npm run test          # Vitest, watch mode
npm run test:run      # Vitest, single run — what CI uses
npm run test:e2e      # Playwright against the production bundle
npm run check         # lint → types → content → MCQ audit → tests → build
```

`npm run check` is the gate. It is what the deploy workflow runs, and nothing ships if it
fails.

## Layout

```
tests/
├── setup.ts                       global environment: fake-indexeddb, fetch guard
├── fixtures/content.ts            a minimal valid content bundle, mutated per test
├── helpers/render.tsx             injected auth + sync providers, fresh database
├── content/validation.test.ts     schema and cross-reference rules
├── content/loader.test.ts         the real shipped content
├── learning/shuffle.test.ts       option shuffling and correctness invariance
├── learning/mcqBias.test.ts       the bias audit, plus the shipped questions
├── learning/scheduler.test.ts     review intervals, due and overdue logic
├── learning/activeTime.test.ts    active time, idle and hidden-tab exclusion
├── persistence/repository.test.ts IndexedDB round-trips, outbox, account lifecycle
├── persistence/sync.test.ts       offline queueing, idempotency, retry and backoff
├── auth/ProtectedRoute.test.tsx   the auth guard and the Czech login screen
├── supabase/rls.test.ts           static assertions over the SQL migration
├── integration/lessonFlow.test.tsx a full lesson, with reload
└── e2e/lesson.spec.ts             Playwright, mobile viewport, production bundle
```

## No test may touch a real Supabase project

Three independent mechanisms enforce this:

1. **`tests/setup.ts` stubs `fetch` to throw.** Any accidental network call fails loudly
   with the attempted URL instead of silently hitting production.
2. **Dependency injection instead of module mocking.** `SyncEngine` takes a
   `getRemote()` function and `SyncProvider` takes a `remoteFactory` prop; tests pass a
   fake in-memory repository or `null`. `AuthProvider` takes a `client` prop, and the
   component tests supply `AuthContext` directly.
3. **No environment variables in tests.** `VITE_SUPABASE_URL` is unset, so
   `getSupabaseClient()` returns `null` and the real client is never constructed.

The e2e suite is the one place a Supabase client does exist. It points at
`https://e2e-placeholder.supabase.co`, a project that does not exist, and every request
to it is intercepted by `page.route`.

### The fake remote

`tests/persistence/sync.test.ts` defines `FakeRemote`, which reproduces the two
properties the real schema guarantees: append-only rows keyed by a client-generated UUID
(so a repeat push is a no-op) and state rows that keep the newer `updated_at`. That makes
the idempotency and last-write-wins tests meaningful rather than tautological.

## What is covered

| Requirement | Where |
| --- | --- |
| Valid lesson JSON | `content/validation.test.ts`, `content/loader.test.ts` |
| Invalid lesson JSON, unknown keys | `content/validation.test.ts` |
| Missing source ID / concept ID | `content/validation.test.ts` |
| Invalid or self-referential prerequisite | `content/validation.test.ts` |
| Duplicate lesson / question / block ID | `content/validation.test.ts` |
| Invalid MCQ `correctOptionId` | `content/validation.test.ts` |
| Option shuffling is a permutation, all positions reachable | `learning/shuffle.test.ts` |
| Shuffling never changes which answer is correct | `learning/shuffle.test.ts` |
| Stable option order during an unfinished attempt | `persistence/repository.test.ts`, `integration/lessonFlow.test.tsx` |
| Correctness evaluated by option ID | `persistence/repository.test.ts`, `integration/lessonFlow.test.tsx` |
| Answer-length bias auditing, thresholds, batch rules | `learning/mcqBias.test.ts` |
| Banned phrases, feedback quality, negation, lexical overlap | `learning/mcqBias.test.ts` |
| Save and resume lesson progress | `persistence/repository.test.ts`, `integration/lessonFlow.test.tsx` |
| Active-time tracking | `learning/activeTime.test.ts` |
| Hidden-tab time exclusion | `learning/activeTime.test.ts` |
| Idle-time exclusion (75 s) | `learning/activeTime.test.ts` |
| Review scheduling, intervals, cap, overdue | `learning/scheduler.test.ts` |
| Offline outbox | `persistence/sync.test.ts` |
| Idempotent synchronisation | `persistence/sync.test.ts` |
| Retry backoff, parking, never deleting local data | `persistence/sync.test.ts` |
| Auth guard, loading state, Czech errors | `auth/ProtectedRoute.test.tsx` |
| RLS enabled, user-scoped policies, `anon` locked out | `supabase/rls.test.ts` |
| Full lesson flow with reload | `integration/lessonFlow.test.tsx` |
| Mobile viewport, production bundle, base path | `e2e/lesson.spec.ts` |

## The integration test

`tests/integration/lessonFlow.test.tsx` runs the real content, real Dexie and the real
block renderers, stubbing only authentication and the remote. It walks
`demo-evidence` end to end:

1. opens the lesson and checks the demo banner appears before any content;
2. answers the prediction block;
3. reaches the MCQ and asserts nothing is revealed before both an option **and** a
   confidence value are supplied;
4. submits and checks the Czech feedback, the correct-option marker and the next review
   date;
5. asserts the stored attempt carries `selectedOptionId: 'vztah'`, not a position;
6. completes the scenario, free-recall (via „Nevím“), summary and personal-transfer
   blocks;
7. checks the completion screen reports the estimate next to the measured active time;
8. unmounts and re-mounts against the same IndexedDB — a reload — and asserts the lesson
   is still completed and the personal note survived.

A second test proves resume: it leaves `demo-rpe` mid-lesson, remounts, and expects the
same block. A third proves the shuffled option order survives a reload of an unfinished
question.

## Notes on jsdom

* Range inputs cannot be dragged. Use `fireEvent.change(slider, { target: { value } })`;
  `userEvent.click` plus arrow keys is unreliable.
* `fake-indexeddb/auto` gives every test file a working IndexedDB. Each test creates its
  own database (`new LearningDatabase(\`ui-${newUuid()}\`)`) so nothing leaks between tests.
* Unmount before deleting the database: the lesson runner flushes measured time on
  unmount, and closing first produces `DatabaseClosedError` noise.

## Playwright

```bash
npm run test:e2e                    # headless
npx playwright test --headed        # watch it run
npx playwright test --debug         # step through
npx playwright show-trace test-results/<test>/trace.zip
```

`playwright.config.ts` builds and serves the production bundle
(`npm run build && npm run preview`) at `http://localhost:4173/neuro-effort-course/`, so
the suite exercises the actual GitHub Pages base path, hash routing and built assets. The
device profile is a phone (Pixel 7), because the product is mobile-first.

Screenshots and traces are captured **only on failure** and land in `test-results/`,
which is git-ignored. Do not commit them without a specific reason.

Playwright routes are matched in **reverse registration order** — the broad catch-alls are
registered first and the specific `**/auth/v1/token**` handler last. Fulfilled responses
still go through the browser's CORS checks, which is why the stubs send
`access-control-allow-*` headers and answer the `OPTIONS` preflight.

## Manual checks

Some things are not worth automating but are worth doing before a release.

### Local preview

```bash
npm run build
npm run preview     # http://localhost:4173/neuro-effort-course/
```

### PWA

DevTools → **Application**:

* **Manifest** — Czech name and short name, `display: standalone`, `scope` and
  `start_url` under the repository path, all three icons loading.
* **Service workers** — one worker, *activated and is running*, scope matching the
  repository path.
* Deploy a new version with an open tab and confirm the Czech prompt
  „Je dostupná nová verze aplikace.“ with **Aktualizovat** / **Později**.

### Offline

1. Load the app once while online.
2. DevTools → Network → tick **Offline**.
3. Reload. The shell and both demo lessons must open.
4. Answer a question. It must save, and the badge must read `Offline` or
   `Čekající změny` — never `Synchronizováno`.
5. Untick **Offline**. The queue must flush and the badge must return to
   `Synchronizováno`.
6. Confirm nothing was lost: the answer is still there.

### Mobile

* DevTools device toolbar, or a real phone on the same network via `npm run dev -- --host`.
* Check no horizontal scrolling at 360 px width (the e2e suite asserts this too).
* Check touch targets are comfortable — the CSS floor is 44 px.
* Check the layout clears the iPhone home indicator (`env(safe-area-inset-bottom)`).

### Accessibility

* Tab through a whole lesson: every control reachable, focus always visible.
* After submitting an answer, focus moves to the feedback and a screen reader announces
  it (`role="status"`, `aria-live="polite"`).
* Correct/incorrect is never signalled by colour alone — each option carries a text
  marker („Správná odpověď“, „Vaše odpověď — nesprávná“).
* `prefers-reduced-motion: reduce` disables transitions.
