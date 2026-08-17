-- Durable, read-only copies of imported Sleeper season payloads.
-- These are league records, not a write-through connection to Sleeper.
create table if not exists public.league_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_year int not null,
  sleeper_league_id text not null,
  captured_at timestamptz not null default now(),
  source text not null default 'sleeper_api',
  payload jsonb not null,
  unique (season_year, sleeper_league_id)
);

create index if not exists league_data_snapshots_year_idx
  on public.league_data_snapshots (season_year desc);

alter table public.league_data_snapshots enable row level security;

drop policy if exists "members can read league snapshots" on public.league_data_snapshots;
create policy "members can read league snapshots" on public.league_data_snapshots
  for select to authenticated
  using (exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    where m.auth_user_id = auth.uid()
  ));

drop policy if exists "commissioners can write league snapshots" on public.league_data_snapshots;
create policy "commissioners can write league snapshots" on public.league_data_snapshots
  for all to authenticated
  using (exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    join public.seasons s on s.id = tm.season_id
    where m.auth_user_id = auth.uid() and tm.is_commissioner and s.year = 2026
  ))
  with check (exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    join public.seasons s on s.id = tm.season_id
    where m.auth_user_id = auth.uid() and tm.is_commissioner and s.year = 2026
  ));
