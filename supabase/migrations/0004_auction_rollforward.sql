alter table public.seasons
  add column if not exists auction_budget_usd numeric(12,2) not null default 200;

alter table public.keeper_rules
  add column if not exists rollforward_roster_source_season int,
  add column if not exists keepers_removed_from_draft_pool boolean not null default true;

create table if not exists public.season_team_budgets (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  opening_budget_usd numeric(12,2) not null default 200,
  keeper_spend_usd numeric(12,2) not null default 0,
  remaining_budget_usd numeric(12,2) generated always as (opening_budget_usd - keeper_spend_usd) stored,
  status text not null default 'rollforward_pending' check (status in ('rollforward_pending', 'keepers_open', 'keepers_locked', 'draft_complete')),
  unique (season_id, team_id)
);

update public.seasons set auction_budget_usd = 200 where year in (2024, 2025, 2026);

update public.keeper_rules kr
set rollforward_roster_source_season = s.year - 1,
    keepers_removed_from_draft_pool = true
from public.seasons s
where kr.season_id = s.id and s.year in (2025, 2026);
