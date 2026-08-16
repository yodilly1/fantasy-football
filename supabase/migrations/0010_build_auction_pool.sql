-- Snapshot the 2026 auction pool after keeper selections are locked.
create table if not exists public.season_draft_pool_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  ownership_history_id uuid not null references public.player_ownership_history(id) on delete restrict,
  source_team_id uuid references public.teams(id) on delete set null,
  status text not null check (status in ('auction', 'keeper')),
  keeper_selection_id uuid references public.keeper_selections(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (season_id, player_id)
);

alter table public.season_draft_pool_entries enable row level security;
create policy "members can read draft pool" on public.season_draft_pool_entries
  for select to authenticated using (public.is_season_member(season_id));

create or replace function public.build_auction_pool(target_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  auction_count int;
  keeper_count int;
begin
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;

  delete from public.season_draft_pool_entries where season_id = target_season;

  with current_roster as (
    select distinct on (h.player_id)
      h.id as ownership_history_id, h.player_id, h.team_id
    from public.player_ownership_history h
    where h.season_id = target_season
    order by h.player_id, h.created_at desc
  )
  insert into public.season_draft_pool_entries (
    season_id, player_id, ownership_history_id, source_team_id, status, keeper_selection_id
  )
  select target_season, r.player_id, r.ownership_history_id, r.team_id,
    case when k.id is null then 'auction' else 'keeper' end,
    k.id
  from current_roster r
  left join public.keeper_selections k
    on k.season_id = target_season
   and k.player_id = r.player_id
   and k.ownership_history_id = r.ownership_history_id;

  select count(*) filter (where status = 'auction'), count(*) filter (where status = 'keeper')
    into auction_count, keeper_count
    from public.season_draft_pool_entries where season_id = target_season;
  return jsonb_build_object('auction_players', coalesce(auction_count, 0), 'keepers', coalesce(keeper_count, 0));
end;
$$;

revoke execute on function public.build_auction_pool(uuid) from anon;
grant execute on function public.build_auction_pool(uuid) to authenticated;

