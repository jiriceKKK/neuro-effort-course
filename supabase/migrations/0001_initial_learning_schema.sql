-- ============================================================================
-- 0001_initial_learning_schema.sql
--
-- Learner state for „Neurokognitivní psychologie úsilí, motivace a změny chování“.
--
-- Scope: this migration stores ONLY personal learner data. Course content (lessons,
-- questions, sources) ships with the application as validated JSON and is deliberately
-- absent here.
--
-- Safety model:
--   * every table has Row Level Security enabled;
--   * the `anon` role receives no table privileges at all;
--   * `authenticated` may touch only rows where user_id = auth.uid(), enforced by both
--     USING and WITH CHECK, so a client can neither read nor write another user's rows;
--   * no SECURITY DEFINER functions are used anywhere.
--
-- The migration is written to be re-runnable: tables use IF NOT EXISTS, policies and
-- triggers are dropped before being recreated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared trigger function
--
-- Maintains created_at/updated_at AND implements the documented conflict strategy for
-- state tables: last write wins by updated_at. When an incoming UPDATE (including the
-- UPDATE half of an upsert) carries an older updated_at than the stored row, the
-- trigger returns NULL, which silently skips the write and keeps the newer data.
-- SECURITY INVOKER (the default) — the function needs no elevated privileges.
-- ----------------------------------------------------------------------------
create or replace function public.handle_row_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  -- Stale write from a device that synchronised late: keep the newer stored row.
  if new.updated_at is not null
     and old.updated_at is not null
     and new.updated_at < old.updated_at then
    return null;
  end if;

  new.created_at := old.created_at;
  new.updated_at := coalesce(new.updated_at, now());
  if new.updated_at <= old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.handle_row_timestamps() is
  'Keeps created_at immutable, refreshes updated_at, and drops UPDATEs whose updated_at is older than the stored row (last-write-wins).';

-- ============================================================================
-- A. lesson_progress
-- ============================================================================
create table if not exists public.lesson_progress (
  user_id             uuid        not null references auth.users (id) on delete cascade,
  lesson_id           text        not null,
  status              text        not null default 'not_started',
  current_block_index integer     not null default 0,
  started_at          timestamptz,
  completed_at        timestamptz,
  active_time_ms      bigint      not null default 0,
  last_opened_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lesson_progress_pkey primary key (user_id, lesson_id),
  constraint lesson_progress_status_check
    check (status in ('not_started', 'in_progress', 'completed')),
  constraint lesson_progress_block_index_check check (current_block_index >= 0),
  constraint lesson_progress_active_time_check check (active_time_ms >= 0)
);

create index if not exists lesson_progress_user_status_idx
  on public.lesson_progress (user_id, status);
create index if not exists lesson_progress_user_updated_idx
  on public.lesson_progress (user_id, updated_at desc);

-- ============================================================================
-- B. learner_events — append-only event log
-- ============================================================================
create table if not exists public.learner_events (
  id          uuid        primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  device_id   text        not null,
  event_type  text        not null,
  lesson_id   text,
  block_id    text,
  concept_id  text,
  question_id text,
  payload     jsonb       not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint learner_events_event_type_check check (
    event_type in (
      'lesson_started',
      'block_opened',
      'answer_submitted',
      'answer_revealed',
      'confidence_recorded',
      'review_rated',
      'lesson_completed',
      'personal_transfer_saved'
    )
  )
);

create index if not exists learner_events_user_occurred_idx
  on public.learner_events (user_id, occurred_at desc);
create index if not exists learner_events_user_lesson_idx
  on public.learner_events (user_id, lesson_id);
create index if not exists learner_events_user_type_idx
  on public.learner_events (user_id, event_type);

-- ============================================================================
-- C. question_attempts — append-only; a retry is a new row
-- ============================================================================
create table if not exists public.question_attempts (
  id                 uuid        primary key,
  user_id            uuid        not null references auth.users (id) on delete cascade,
  question_id        text        not null,
  lesson_id          text        not null,
  concept_ids        text[]      not null default '{}',
  selected_option_id text,
  free_response      text,
  -- 0 = incorrect, 1 = partially correct, 2 = correct, null = not yet evaluated
  correctness        smallint,
  confidence         smallint,
  hint_used          boolean     not null default false,
  response_time_ms   bigint      not null default 0,
  attempt_number     integer     not null default 1,
  created_at         timestamptz not null default now(),
  constraint question_attempts_correctness_check check (correctness is null or correctness in (0, 1, 2)),
  constraint question_attempts_confidence_check check (confidence is null or (confidence between 0 and 100)),
  constraint question_attempts_attempt_number_check check (attempt_number >= 1),
  constraint question_attempts_response_time_check check (response_time_ms >= 0)
);

create index if not exists question_attempts_user_question_idx
  on public.question_attempts (user_id, question_id);
create index if not exists question_attempts_user_created_idx
  on public.question_attempts (user_id, created_at desc);
create index if not exists question_attempts_user_lesson_idx
  on public.question_attempts (user_id, lesson_id);

-- ============================================================================
-- D. review_state — one row per schedulable item, not per lesson
-- ============================================================================
create table if not exists public.review_state (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  item_id        text        not null,
  item_type      text        not null default 'question',
  concept_id     text        not null,
  due_at         timestamptz not null,
  last_result    text        not null,
  interval_days  numeric     not null default 1,
  difficulty     numeric     not null default 5,
  stability      numeric     not null default 1,
  retrievability numeric     not null default 1,
  review_count   integer     not null default 0,
  lapse_count    integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint review_state_pkey primary key (user_id, item_id),
  constraint review_state_item_type_check check (item_type in ('question', 'concept')),
  constraint review_state_last_result_check check (last_result in ('fail', 'hard', 'good', 'easy')),
  constraint review_state_interval_check check (interval_days > 0),
  constraint review_state_counts_check check (review_count >= 0 and lapse_count >= 0)
);

create index if not exists review_state_user_due_idx
  on public.review_state (user_id, due_at);
create index if not exists review_state_user_concept_idx
  on public.review_state (user_id, concept_id);

-- ============================================================================
-- E. personal_notes — one note per (user, lesson, block)
-- ============================================================================
create table if not exists public.personal_notes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  lesson_id  text        not null,
  block_id   text        not null,
  note       text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_notes_unique_block unique (user_id, lesson_id, block_id)
);

create index if not exists personal_notes_user_lesson_idx
  on public.personal_notes (user_id, lesson_id);

-- ============================================================================
-- F. user_settings
-- ============================================================================
create table if not exists public.user_settings (
  user_id                   uuid        primary key references auth.users (id) on delete cascade,
  preferred_session_minutes integer     not null default 30,
  target_retention          numeric     not null default 0.88,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint user_settings_session_minutes_check check (preferred_session_minutes between 5 and 240),
  constraint user_settings_target_retention_check check (target_retention > 0 and target_retention < 1)
);

-- ============================================================================
-- Triggers
-- ============================================================================
drop trigger if exists lesson_progress_timestamps on public.lesson_progress;
create trigger lesson_progress_timestamps
  before insert or update on public.lesson_progress
  for each row execute function public.handle_row_timestamps();

drop trigger if exists review_state_timestamps on public.review_state;
create trigger review_state_timestamps
  before insert or update on public.review_state
  for each row execute function public.handle_row_timestamps();

drop trigger if exists personal_notes_timestamps on public.personal_notes;
create trigger personal_notes_timestamps
  before insert or update on public.personal_notes
  for each row execute function public.handle_row_timestamps();

drop trigger if exists user_settings_timestamps on public.user_settings;
create trigger user_settings_timestamps
  before insert or update on public.user_settings
  for each row execute function public.handle_row_timestamps();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.lesson_progress   enable row level security;
alter table public.learner_events    enable row level security;
alter table public.question_attempts enable row level security;
alter table public.review_state      enable row level security;
alter table public.personal_notes    enable row level security;
alter table public.user_settings     enable row level security;

-- Belt and braces: even if a future GRANT is added by mistake, RLS still applies to
-- the table owner's dependents. Forcing RLS keeps the rules in effect for owners too.
alter table public.lesson_progress   force row level security;
alter table public.learner_events    force row level security;
alter table public.question_attempts force row level security;
alter table public.review_state      force row level security;
alter table public.personal_notes    force row level security;
alter table public.user_settings     force row level security;

-- The browser talks to PostgREST as `anon` before login and `authenticated` after it.
-- Learner data must be unreachable for `anon` at the privilege level, not only via RLS.
revoke all on table public.lesson_progress   from anon;
revoke all on table public.learner_events    from anon;
revoke all on table public.question_attempts from anon;
revoke all on table public.review_state      from anon;
revoke all on table public.personal_notes    from anon;
revoke all on table public.user_settings     from anon;

grant select, insert, update, delete on table public.lesson_progress to authenticated;
grant select, insert, update, delete on table public.review_state    to authenticated;
grant select, insert, update, delete on table public.personal_notes  to authenticated;
grant select, insert, update, delete on table public.user_settings   to authenticated;
-- Append-only tables: no UPDATE privilege at all.
grant select, insert, delete on table public.learner_events    to authenticated;
grant select, insert, delete on table public.question_attempts to authenticated;

-- ----------------------------------------------------------------------------
-- Policies. `(select auth.uid())` is used instead of a bare `auth.uid()` so the planner
-- evaluates it once per statement rather than once per row.
-- ----------------------------------------------------------------------------

-- lesson_progress
drop policy if exists lesson_progress_select_own on public.lesson_progress;
create policy lesson_progress_select_own on public.lesson_progress
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists lesson_progress_insert_own on public.lesson_progress;
create policy lesson_progress_insert_own on public.lesson_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists lesson_progress_update_own on public.lesson_progress;
create policy lesson_progress_update_own on public.lesson_progress
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists lesson_progress_delete_own on public.lesson_progress;
create policy lesson_progress_delete_own on public.lesson_progress
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- learner_events (append-only: select, insert, delete)
drop policy if exists learner_events_select_own on public.learner_events;
create policy learner_events_select_own on public.learner_events
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists learner_events_insert_own on public.learner_events;
create policy learner_events_insert_own on public.learner_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists learner_events_delete_own on public.learner_events;
create policy learner_events_delete_own on public.learner_events
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- question_attempts (append-only: select, insert, delete)
drop policy if exists question_attempts_select_own on public.question_attempts;
create policy question_attempts_select_own on public.question_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists question_attempts_insert_own on public.question_attempts;
create policy question_attempts_insert_own on public.question_attempts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists question_attempts_delete_own on public.question_attempts;
create policy question_attempts_delete_own on public.question_attempts
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- review_state
drop policy if exists review_state_select_own on public.review_state;
create policy review_state_select_own on public.review_state
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists review_state_insert_own on public.review_state;
create policy review_state_insert_own on public.review_state
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists review_state_update_own on public.review_state;
create policy review_state_update_own on public.review_state
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists review_state_delete_own on public.review_state;
create policy review_state_delete_own on public.review_state
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- personal_notes
drop policy if exists personal_notes_select_own on public.personal_notes;
create policy personal_notes_select_own on public.personal_notes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists personal_notes_insert_own on public.personal_notes;
create policy personal_notes_insert_own on public.personal_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists personal_notes_update_own on public.personal_notes;
create policy personal_notes_update_own on public.personal_notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists personal_notes_delete_own on public.personal_notes;
create policy personal_notes_delete_own on public.personal_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- user_settings
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own on public.user_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================================
-- Verification helpers (run manually after applying the migration)
--
--   select tablename, rowsecurity
--     from pg_tables
--    where schemaname = 'public'
--      and tablename in ('lesson_progress','learner_events','question_attempts',
--                        'review_state','personal_notes','user_settings');
--   -- every row must show rowsecurity = true
--
--   select tablename, policyname, roles, cmd
--     from pg_policies
--    where schemaname = 'public'
--    order by tablename, policyname;
--   -- every policy must list {authenticated} and never {public} or {anon}
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'anon';
--   -- must return zero rows for the six tables above
-- ============================================================================
