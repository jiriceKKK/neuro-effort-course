# Supabase setup

Everything needed to point the application at a Supabase project, apply the schema, and
prove that one learner cannot read another's data.

## 1. Security model in one paragraph

The browser bundle ships two values: the project URL and the **publishable (anon) key**.
Both are public by design. They are only safe because Row Level Security is enabled on
every user table and the `anon` role has had all table privileges revoked, so an
unauthenticated client can read nothing at all and an authenticated client can only reach
rows where `user_id = auth.uid()`.

**Never** put any of these in a `VITE_` variable, in client code, or in a committed file:

* the service-role key,
* a secret key (`sb_secret_…`),
* the database password,
* a `postgresql://` connection string.

Every `VITE_` variable is inlined into public JavaScript. Treat them as printed on a
billboard.

## 2. Environment variables

Copy `.env.example` to `.env.local` (git-ignored) and fill in:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_ALLOW_SIGNUP=false
```

Both values are in the Supabase Dashboard under **Project Settings → API**. Take the
*publishable*/anon key, never the service-role key.

If either value is missing, the app shows a Czech configuration screen naming the missing
variables instead of failing with a cryptic error.

For GitHub Actions the same two values go in as **repository variables** — see
[DEPLOYMENT.md](DEPLOYMENT.md).

## 3. Applying the migration

The migration is `supabase/migrations/0001_initial_learning_schema.sql`. It creates six
tables, their indexes, the shared timestamp trigger, and all RLS policies. It is written
to be re-runnable: tables use `IF NOT EXISTS`, and policies and triggers are dropped
before being recreated.

### Option A — SQL Editor (no tooling needed)

1. Supabase Dashboard → your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_initial_learning_schema.sql`.
3. **Run**. Expect `Success. No rows returned.`
4. Check **Database → Tables**: `lesson_progress`, `learner_events`, `question_attempts`,
   `review_state`, `personal_notes`, `user_settings`, each showing *RLS enabled*.

### Option B — Supabase CLI

```bash
npm install -g supabase          # or: brew install supabase/tap/supabase
supabase login                   # opens a browser
supabase link --project-ref <project-ref>
supabase db push
```

`<project-ref>` is the subdomain of your project URL. `supabase link` will ask for the
database password; it is stored locally and must never be committed.

To iterate locally first:

```bash
supabase start                   # local Postgres + Studio in Docker
supabase db reset                # applies every migration from scratch
```

> This repository has **not** been linked to any project. Nothing in it contains a project
> reference, an access token or a database password, and none of those may be guessed.

## 4. Creating the first user

`VITE_ALLOW_SIGNUP=false` (the default) means the app shows no registration form. Create
users manually:

1. Dashboard → **Authentication → Users** → **Add user** → **Create new user**.
2. Enter the e-mail and a password.
3. Tick **Auto Confirm User**, otherwise the learner sees
   „E-mail zatím není potvrzený.“ at login.
4. **Create user**.

Sign in with those credentials at the deployed URL.

To open registration instead, set `VITE_ALLOW_SIGNUP=true` and make sure e-mail signup is
enabled under **Authentication → Providers → Email**. Registration is intentionally not
the primary flow: this is a curated course, not a public service.

Magic links, OAuth and social login are deliberately out of scope.

## 5. Verifying RLS

### From the Dashboard

```sql
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('lesson_progress','learner_events','question_attempts',
                     'review_state','personal_notes','user_settings');
```

Every row must show `rowsecurity = true`.

```sql
select tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
```

Every policy must list `{authenticated}`. If you see `{public}` or `{anon}`, stop and fix
it before putting any real data in.

```sql
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee = 'anon'
   and table_name in ('lesson_progress','learner_events','question_attempts',
                      'review_state','personal_notes','user_settings');
```

Must return **zero rows**.

### From the repository

`tests/supabase/rls.test.ts` asserts the same properties statically against the migration
file: RLS enabled and forced on all six tables, `anon` revoked, every policy scoped to
`authenticated` with an `auth.uid()` predicate, `WITH CHECK` on every INSERT and UPDATE,
no `SECURITY DEFINER`, and no update policy on the append-only tables. It runs as part of
`npm run check`.

## 6. Two-user isolation test

Static checks cannot prove the running database is safe. Do this once after applying the
migration.

1. Create two users, `a@example.test` and `b@example.test` (both auto-confirmed).
2. Sign in as A in the app, open a demo lesson, answer a question. This writes rows.
3. Confirm the rows exist, as the service role, in the SQL Editor:

   ```sql
   select user_id, lesson_id, current_block_index from public.lesson_progress;
   ```

4. Sign out, sign in as B, and open the browser console on the deployed app:

   ```js
   const { data, error } = await window.__supabase__?.from('lesson_progress').select('*')
   ```

   The client is not exposed globally, so instead use the app itself: B's dashboard must
   show **no** progress from A. B's „Postup“ screen must be empty.

5. The direct check, from a terminal, using only the publishable key and B's session:

   ```bash
   # 1. Sign in as B and capture the access token
   curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/token?grant_type=password" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email":"b@example.test","password":"<b-password>"}'

   # 2. Ask for every row in the table with B's token
   curl -s "$VITE_SUPABASE_URL/rest/v1/lesson_progress?select=*" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
     -H "Authorization: Bearer <b-access-token>"
   ```

   The second call must return `[]` — B sees none of A's rows even when asking for all of
   them.

6. Confirm the anonymous case too:

   ```bash
   curl -s "$VITE_SUPABASE_URL/rest/v1/lesson_progress?select=*" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY"
   ```

   Must return a permission error, not data.

7. Try to write into someone else's row (this is what `WITH CHECK` prevents):

   ```bash
   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/lesson_progress" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
     -H "Authorization: Bearer <b-access-token>" \
     -H "Content-Type: application/json" \
     -d '{"user_id":"<A-user-id>","lesson_id":"demo-rpe","status":"completed"}'
   ```

   Must fail with `new row violates row-level security policy`.

## 7. Schema reference

| Table | Key | Notes |
| --- | --- | --- |
| `lesson_progress` | `(user_id, lesson_id)` | `status` constrained to `not_started \| in_progress \| completed`; `active_time_ms` is measured active time |
| `learner_events` | `id uuid` | Append-only log; no UPDATE privilege is granted at all |
| `question_attempts` | `id uuid` | Append-only; a retry is a new row with a higher `attempt_number`; `correctness` is `0 \| 1 \| 2 \| null` |
| `review_state` | `(user_id, item_id)` | One row per schedulable item, not per lesson |
| `personal_notes` | `id uuid`, unique `(user_id, lesson_id, block_id)` | Upserted on the natural key so two devices converge |
| `user_settings` | `user_id` | Defaults: 30 minutes per session, 0.88 target retention |

All six reference `auth.users(id)` with `ON DELETE CASCADE`, so deleting a user removes
their data.

### The timestamp trigger

`public.handle_row_timestamps()` is `SECURITY INVOKER` with `search_path = ''` — it needs
no elevated privileges, so the migration contains **no** `SECURITY DEFINER` function. It
keeps `created_at` immutable, refreshes `updated_at`, and implements the documented
last-write-wins rule by returning `NULL` when an incoming `UPDATE` carries an older
`updated_at` than the stored row, which skips the write and keeps the newer data.

## 8. Troubleshooting

| Symptom | Cause |
| --- | --- |
| „Aplikace není připojena k databázi.“ | `.env.local` missing or empty; restart the dev server after editing it |
| „Nesprávný e-mail nebo heslo.“ | Wrong credentials, or the user was never created |
| „E-mail zatím není potvrzený.“ | Created without **Auto Confirm User** |
| Badge stuck on „Čekající změny“ | Not signed in, or offline — data is safe in IndexedDB and will push later |
| Badge shows „Chyba synchronizace“ | Migration not applied, or RLS is rejecting the write. Check the error under Settings → Synchronizace, then the Supabase logs |
| `permission denied for table …` | The migration was not run against this project |
