-- Restore the manager-confirmed keeper that was absent when the zero-keeper
-- lock was recorded. George Pickens was drafted for $8, so his keeper cost is $13.
alter table public.keeper_selections disable trigger keeper_selection_lock_guard;

insert into public.keeper_selections (
  season_id, team_id, player_id, ownership_history_id,
  base_cost_usd, final_cost_usd, keeper_year_number, eligible, eligibility_reason
)
select
  s.id, h.team_id, h.player_id, h.id,
  13, 13, 1, true, 'Restored from manager confirmation; drafted price + $5'
from public.seasons s
join public.player_ownership_history h on h.season_id = s.id
join public.players p on p.id = h.player_id
join public.teams t on t.id = h.team_id
where s.year = 2026
  and t.display_name = 'EatMyHenry'
  and p.name = 'George Pickens'
on conflict (season_id, team_id, player_id) do update
set base_cost_usd = excluded.base_cost_usd,
    final_cost_usd = excluded.final_cost_usd,
    eligibility_reason = excluded.eligibility_reason;

alter table public.keeper_selections enable trigger keeper_selection_lock_guard;

update public.season_team_budgets b
set keeper_spend_usd = coalesce((
  select sum(ks.final_cost_usd)
  from public.keeper_selections ks
  where ks.season_id = b.season_id and ks.team_id = b.team_id
), 0),
    status = 'keepers_locked',
    locked_at = coalesce(locked_at, now())
from public.teams t
where b.team_id = t.id
  and b.season_id = (select id from public.seasons where year = 2026)
  and t.display_name = 'EatMyHenry';
