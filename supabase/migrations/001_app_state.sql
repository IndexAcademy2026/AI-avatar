-- Shared app state: one JSON row holding avatars, projects, folders, backgrounds,
-- voice nicknames and builtin-look overrides. No login exists in this app, so this
-- is intentionally one global library shared by every visitor — not per-user data.
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- The app only ever uses the anon key (no auth), so anon needs full read/write.
-- (CREATE POLICY has no IF NOT EXISTS in Postgres, so drop-then-create for safe re-runs.)
drop policy if exists "anon can read app_state" on public.app_state;
create policy "anon can read app_state"
  on public.app_state for select
  using (true);

drop policy if exists "anon can insert app_state" on public.app_state;
create policy "anon can insert app_state"
  on public.app_state for insert
  with check (true);

drop policy if exists "anon can update app_state" on public.app_state;
create policy "anon can update app_state"
  on public.app_state for update
  using (true) with check (true);

-- Seed the single shared row the app reads/writes (id = 'global').
insert into public.app_state (id, data)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

-- Enable Realtime so open tabs in other browsers pick up changes live.
-- (Wrapped so re-running this script doesn't error if it's already added.)
do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception when duplicate_object then
  null;
end $$;
