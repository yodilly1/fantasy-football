-- Quinshon Judkins was acquired by Florida Men via waiver after the 2025
-- auction. His original $1 auction price does not carry over to the keeper
-- price; waiver/free-agent keepers are always $5.
alter table public.keeper_selections disable trigger keeper_selection_lock_guard;

update public.keeper_selections ks
set base_cost_usd = 5,
    final_cost_usd = 5
from public.players p
where ks.player_id = p.id
  and ks.season_id = (select id from public.seasons where year = 2026)
  and p.name = 'Quinshon Judkins';

alter table public.keeper_selections enable trigger keeper_selection_lock_guard;

update public.season_team_budgets b
set keeper_spend_usd = coalesce((
  select sum(ks.final_cost_usd)
  from public.keeper_selections ks
  where ks.season_id = b.season_id
    and ks.team_id = b.team_id
), 0)
where b.season_id = (select id from public.seasons where year = 2026);
