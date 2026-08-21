-- Apply the passed 2026 keeper-rule proposal everywhere the active rule set
-- and saved keeper prices are used. Historical 2024/2025 rules remain intact.
update public.keeper_rules
set keeper_tax_usd = 5,
    universal_floor_usd = null,
    rb_floor_usd = null,
    wr_floor_usd = null,
    adp_exception_enabled = false,
    adp_median_usd = null,
    adp_extra_tax_usd = null,
    rb_adp_median_usd = null,
    wr_adp_median_usd = null,
    notes = '2026 passed keeper rule: prior draft/keeper price + $5; no positional floors or ADP exception; maximum two keepers.'
where season_id = (select id from public.seasons where year = 2026);

-- Repricing is an administrative data correction. Preserve each team's locked
-- status while allowing this one migration to update the stored costs.
alter table public.keeper_selections disable trigger keeper_selection_lock_guard;

update public.keeper_selections ks
set base_cost_usd = case
      when h.acquisition_type in ('waiver', 'free_agent') then 5
      else coalesce(h.auction_cost_usd, 0) + 5
    end,
    final_cost_usd = case
      when h.acquisition_type in ('waiver', 'free_agent') then 5
      else coalesce(h.auction_cost_usd, 0) + 5
    end
from public.player_ownership_history h
where ks.season_id = (select id from public.seasons where year = 2026)
  and h.id = ks.ownership_history_id;

alter table public.keeper_selections enable trigger keeper_selection_lock_guard;

update public.season_team_budgets b
set keeper_spend_usd = coalesce((
  select sum(ks.final_cost_usd)
  from public.keeper_selections ks
  where ks.season_id = b.season_id and ks.team_id = b.team_id
), 0)
where b.season_id = (select id from public.seasons where year = 2026);
