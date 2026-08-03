import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static checks on the SQL migration.
 *
 * These cannot replace running the migration against a real project, but they catch the
 * mistakes that matter most and that are easy to make while editing SQL by hand: a table
 * added without RLS, a policy that forgets `WITH CHECK`, or a grant left open to `anon`.
 */

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0001_initial_learning_schema.sql'),
  'utf8',
).toLowerCase()

/** Whitespace-normalised copy so column alignment in the SQL cannot break assertions. */
const FLAT = SQL.replace(/\s+/g, ' ')

/** Executable SQL only — the file's prose comments mention the terms they warn against. */
const CODE = SQL.replace(/--[^\n]*/g, '')

const USER_TABLES: string[] = [
  'lesson_progress',
  'learner_events',
  'question_attempts',
  'review_state',
  'personal_notes',
  'user_settings',
]

/** Policy bodies, split on `create policy`. */
const POLICY_BLOCKS = SQL.split('create policy ').slice(1)

describe('migration 0001 — table definitions', () => {
  it.each(USER_TABLES)('creates %s', (table) => {
    expect(SQL).toContain(`create table if not exists public.${table}`)
  })

  it('constrains lesson_progress.status to the three allowed values', () => {
    expect(SQL).toContain("status in ('not_started', 'in_progress', 'completed')")
  })

  it('constrains correctness to 0, 1, 2 or null', () => {
    expect(SQL).toContain('correctness is null or correctness in (0, 1, 2)')
  })

  it('uses the required composite primary keys', () => {
    expect(SQL).toContain('lesson_progress_pkey primary key (user_id, lesson_id)')
    expect(SQL).toContain('review_state_pkey primary key (user_id, item_id)')
  })

  it('ships the documented default session length and target retention', () => {
    expect(SQL).toContain('preferred_session_minutes integer     not null default 30')
    expect(SQL).toContain('target_retention          numeric     not null default 0.88')
  })
})

describe('migration 0001 — row level security', () => {
  it.each(USER_TABLES)('enables RLS on %s', (table) => {
    expect(FLAT).toContain(`alter table public.${table} enable row level security`)
  })

  it.each(USER_TABLES)('forces RLS on %s so owners are not exempt', (table) => {
    expect(FLAT).toContain(`alter table public.${table} force row level security`)
  })

  it.each(USER_TABLES)('revokes every privilege on %s from anon', (table) => {
    expect(FLAT).toContain(`revoke all on table public.${table} from anon`)
  })

  it('never grants anything to anon or the public role', () => {
    expect(SQL).not.toMatch(/grant[^;]*\bto\s+anon\b/)
    expect(SQL).not.toMatch(/grant[^;]*\bto\s+public\b/)
  })

  it.each(USER_TABLES)('gives %s a user-scoped select policy', (table) => {
    const policy = POLICY_BLOCKS.find(
      (block) => block.startsWith(`${table}_select_own`) && block.includes('for select'),
    )
    expect(policy, `chybí select policy pro ${table}`).toBeDefined()
    expect(policy).toContain('to authenticated')
    expect(policy).toContain('user_id = (select auth.uid())')
  })

  it.each(USER_TABLES)('gives %s an insert policy with a matching WITH CHECK', (table) => {
    const policy = POLICY_BLOCKS.find(
      (block) => block.startsWith(`${table}_insert_own`) && block.includes('for insert'),
    )
    expect(policy, `chybí insert policy pro ${table}`).toBeDefined()
    expect(policy).toContain('to authenticated')
    expect(policy).toContain('with check (user_id = (select auth.uid()))')
  })

  it('gives every update policy both USING and WITH CHECK', () => {
    const updatePolicies = POLICY_BLOCKS.filter((block) => block.includes('for update'))
    expect(updatePolicies.length).toBeGreaterThan(0)
    for (const policy of updatePolicies) {
      expect(policy).toContain('using (user_id = (select auth.uid()))')
      expect(policy).toContain('with check (user_id = (select auth.uid()))')
    }
  })

  it('scopes every policy to the authenticated role only', () => {
    for (const policy of POLICY_BLOCKS) {
      expect(policy).toContain('to authenticated')
      expect(policy).not.toMatch(/\bto\s+anon\b/)
      expect(policy).not.toMatch(/\bto\s+public\b/)
    }
  })

  it('scopes every policy predicate to the calling user', () => {
    for (const policy of POLICY_BLOCKS) {
      expect(policy).toContain('user_id = (select auth.uid())')
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/)
    }
  })

  it('keeps the append-only tables free of update policies', () => {
    for (const table of ['learner_events', 'question_attempts']) {
      const updatePolicy = POLICY_BLOCKS.find(
        (block) => block.startsWith(`${table}_`) && block.includes('for update'),
      )
      expect(updatePolicy, `${table} nesmí mít update policy`).toBeUndefined()
      expect(FLAT).toContain(
        `grant select, insert, delete on table public.${table} to authenticated`,
      )
    }
  })
})

describe('migration 0001 — functions and indexes', () => {
  it('uses no SECURITY DEFINER function', () => {
    expect(CODE).not.toContain('security definer')
    expect(CODE).toContain('security invoker')
  })

  it('pins an empty search_path on the trigger function', () => {
    expect(SQL).toContain("set search_path = ''")
  })

  it('maintains updated_at and drops stale writes', () => {
    expect(SQL).toContain('create or replace function public.handle_row_timestamps()')
    expect(SQL).toContain('new.updated_at < old.updated_at')
    expect(SQL).toContain('return null')
  })

  it.each(['lesson_progress', 'review_state', 'personal_notes', 'user_settings'])(
    'attaches the timestamp trigger to %s',
    (table) => {
      expect(FLAT).toContain(
        `create trigger ${table}_timestamps before insert or update on public.${table}`,
      )
    },
  )

  it('indexes the columns the app filters on', () => {
    for (const index of [
      'lesson_progress_user_status_idx',
      'learner_events_user_occurred_idx',
      'question_attempts_user_question_idx',
      'review_state_user_due_idx',
      'personal_notes_user_lesson_idx',
    ]) {
      expect(SQL).toContain(index)
    }
  })

  it('contains no real credentials', () => {
    expect(CODE).not.toContain('service_role')
    expect(CODE).not.toContain('sb_secret_')
    expect(CODE).not.toContain('postgresql://')
  })
})
