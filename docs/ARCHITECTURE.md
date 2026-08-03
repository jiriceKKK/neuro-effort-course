# Architecture

Engineering documentation. English by convention; every learner-facing string produced by
this system is Czech.

## 1. Layers

The application is split into four layers that are allowed to depend downward only.

```
┌──────────────────────────────────────────────────────────────┐
│ D. Deployment & configuration                                │
│    vite.config.ts · .github/workflows · supabase/migrations  │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ C. Learner state (personal)                                  │
│    src/persistence/{local,remote,sync} · src/types           │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ B. Engine (reusable)                                         │
│    src/components/blocks · src/learning/{scheduler,timing,   │
│    mastery,questionQuality} · src/features/*                 │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ A. Course content (static, shipped with the app)             │
│    src/content/*.json · schema.ts · validation.ts · loader.ts│
└──────────────────────────────────────────────────────────────┘
```

### A. Course content

`course.json`, `concepts.json`, `sources.json` and `lessons/*.json`. Lessons are picked
up by `import.meta.glob`, so adding `src/content/lessons/<id>.json` registers a lesson —
no code change.

Two hard rules:

* content never lives in Supabase;
* content never lives inside a React component.

`validation.ts` is environment-independent: the browser loader, the Vitest suite and the
`content:validate` CLI all call `validateContentBundle` with the same raw bundle, so the
CLI cannot pass while the app fails.

### B. Engine

`BlockRenderer` dispatches a block to its renderer through an exhaustive `switch`, so
adding a variant to `lessonBlockSchema` without a renderer is a compile error. Renderers
talk to persistence only through the `BlockApi` seam (`src/components/blocks/blockApi.ts`);
they never import Dexie or Supabase.

`src/learning/` holds the pure logic: the review scheduler, the active-time tracker,
concept mastery + dashboard priority, and the MCQ shuffling and bias analysis.

### C. Learner state

Local-first, always. Every learner write goes:

```
UI action
  └─ LocalRepository            (IndexedDB write + outbox row, one transaction)
       └─ SyncProvider          (debounced trigger)
            └─ SyncEngine       (claim → push → mark, bounded backoff)
                 └─ SupabaseRemoteRepository
```

The local write and the outbox row happen in one Dexie transaction, so a record can never
exist without being queued.

### D. Deployment & configuration

Base-path resolution, the PWA manifest and service worker, the GitHub Actions workflow,
and the SQL migration that creates the tables and their RLS policies.

## 2. Data flow through a lesson

1. `useLessonRunner` loads the lesson from the content loader and the learner's
   `lesson_progress` row from IndexedDB, then resumes at `currentBlockIndex`.
2. An `ActiveTimeTracker` starts, seeded with the time already accumulated.
3. A block renderer receives `BlockApi`. On an answer it: records confidence, appends a
   `question_attempts` row, appends `learner_events`, schedules the review item, and
   deletes the attempt draft.
4. Active time is flushed to IndexedDB every 15 s and on unmount.
5. On the last block, `completeLesson` stops the clock, marks the row `completed` and
   appends `lesson_completed` with the measured time next to the published estimate.

Screens always render from IndexedDB, never from a network response. That is what makes
the dashboard, the review queue and the progress view behave identically offline.

## 3. Synchronisation

### Outbox

`OutboxRecord` carries `entityType`, `entityKey`, `operation`, `status`
(`pending | syncing | synced | failed`), `attempts`, `nextAttemptAt` and `lastError`.
The pusher reads the *current* local row at push time, so repeated upserts of the same
row collapse into one queued entry while append-only inserts never collapse.

Triggers: application start, login/logout, the `online` event, any new local write
(debounced 1.5 s), and „Synchronizovat nyní“.

Retries use bounded exponential backoff (5 s → 5 min, capped) and park an entry as
`failed` after six attempts. The manual button revives parked entries.

**Local data is never deleted because a remote request failed.**

### Idempotency

| Table | Strategy |
| --- | --- |
| `learner_events`, `question_attempts` | Client-generated UUID primary key, inserted with `ON CONFLICT DO NOTHING`. Re-pushing after an ambiguous failure is a no-op. |
| `lesson_progress`, `review_state`, `user_settings` | Upsert on the natural key. |
| `personal_notes` | Upsert on `(user_id, lesson_id, block_id)`; the local `id` is not sent, so two devices that both wrote the note offline converge on one row. |

### Conflict resolution — last write wins on `updated_at`

State tables carry `updated_at` set by the writing device. The database trigger
`public.handle_row_timestamps()` runs `BEFORE INSERT OR UPDATE` and:

* on INSERT, fills `created_at`/`updated_at` when absent;
* on UPDATE, **returns `NULL` when the incoming `updated_at` is older than the stored
  one**, which skips the write and keeps the newer row;
* otherwise refreshes `updated_at` and keeps `created_at` immutable.

So a device that was offline for a week cannot overwrite newer progress when it finally
syncs. This is a deliberate, simple rule: it can still lose a concurrent edit made on
another device within the same second, which is acceptable for single-learner data.

Czech status labels: `Synchronizováno`, `Offline`, `Čekající změny`,
`Probíhá synchronizace`, `Chyba synchronizace`.

### Signed-out work

Before login, rows are owned by the pseudo-user `local`. On login,
`LocalRepository.adoptLocalData` rewrites them under the real user ID and re-queues them
— work done before signing in is never discarded.

## 4. Why HashRouter

GitHub Pages serves static files with no rewrite rules. Under `BrowserRouter`, opening or
refreshing `https://owner.github.io/neuro-effort-course/lekce/demo-rpe` asks Pages for a
file that does not exist and returns 404. `HashRouter` keeps the whole route after `#`,
so every deep link resolves to `index.html` under any repository subpath, and the
installed PWA restores its route after a cold start.

The usual workaround (a `404.html` that redirects) costs a round trip and interacts badly
with service-worker navigation fallback. Hash routing has no such edge cases here.

## 5. Why course content is not in Supabase

* **Offline.** Content bundled with the app is available on first load and cached by the
  service worker. Fetched content would need its own cache, invalidation and failure UI.
* **Review.** Lessons are scientific material. In Git they get diffs, review, blame and
  a `status` lifecycle. In a database they get an `UPDATE`.
* **Validation.** Zod plus cross-reference checks run in CI, so broken content cannot be
  deployed. A database row can be edited past any check.
* **Cost and simplicity.** No read path, no caching layer, no CDN invalidation.
* **Separation.** Supabase then holds *only* personal data, which keeps the RLS story
  short: every table is user-scoped, with no public-read exception.

The trade-off: publishing content requires a deploy. At the intended cadence (batches of
five reviewed lessons) that is the right side of the trade.

## 6. Base-path resolution

`resolveBasePath` in `vite.config.ts` takes the first answer available:

1. `VITE_BASE_PATH` — explicit override (also for custom domains);
2. `GITHUB_REPOSITORY` — `owner/repo`, injected by GitHub Actions;
3. `git remote get-url origin` — local production builds and forks;
4. `/` — safe fallback, correct for a user/organisation site.

Development always uses `/`. The GitHub user name is never hardcoded anywhere.

## 7. Time integrity

`ActiveTimeTracker` counts time only while the learner is plausibly working. It stops on
hidden tab (Page Visibility API), after 75 s without interaction, and while the app is
blocked on a long network request. It uses `performance.now()` so wall-clock adjustments
cannot inflate a session, and the clock is injectable for deterministic tests.

Idle time is recorded rather than discarded, so estimates can be audited later. Content
validation rejects a lesson whose block estimates fall outside its own declared range.

## 8. MVP limitations

* The review scheduler is a transparent prototype, not FSRS. `difficulty`, `stability`
  and `retrievability` are stored and kept coherent so the algorithm can be swapped
  without a data migration.
* Sync is **push-only**. A fresh device does not pull existing cloud data; it starts
  empty and uploads what it produces. Multi-device pull is the first thing to add.
* Free-recall answers are self-rated. No automatic grading, and no AI in the app.
* Concept mastery is a simple accuracy plus a confidence-versus-accuracy gap.
* The JS bundle is a single ~730 kB chunk (~213 kB gzipped). Acceptable for a precached
  PWA; route-level code splitting is the obvious next optimisation.
* The Vitest suite runs in jsdom, so service-worker behaviour is covered only by the
  Playwright pass and by manual checks.

## 9. Extension points

| Want to add | Touch |
| --- | --- |
| A lesson | one JSON file in `src/content/lessons/` |
| A block type | schema variant → renderer → `BlockRenderer` switch |
| A real scheduler | `src/learning/scheduler/scheduler.ts` only; the state shape already fits |
| Multi-device pull | a `pull()` phase in `SyncEngine` plus `select` calls in `SupabaseRemoteRepository` |
| A new module in the course map | `course.json` |
| Different question analytics | `src/learning/questionQuality/mcqBias.ts`, shared by the CLI and the tests |
