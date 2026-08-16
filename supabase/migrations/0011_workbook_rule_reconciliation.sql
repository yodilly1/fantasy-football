-- Reconcile the 2025 Rules and Payouts sheets into the live 2026 configuration.
-- NIS is the league ledger currency; USD remains the auction/keeper currency.

alter table public.keeper_rules
  add column if not exists rb_adp_median_usd numeric(12,2),
  add column if not exists wr_adp_median_usd numeric(12,2);

update public.keeper_rules kr
set rb_adp_median_usd = 27,
    wr_adp_median_usd = 28,
    adp_exception_enabled = true,
    adp_extra_tax_usd = 8,
    notes = '2025 workbook rules: max 2 keepers; same player may be kept twice by current team; traded player starts a new clock; auction/prior keeper is last cost + $5; waiver/free-agent keeper is flat $5; RB floor $13; WR floor $14; no floor QB/TE/K/DEF; ADP exception applies above RB median $27 or WR median $28 and uses the greater of last cost + $8 or floor + $8. Rookie exception remains a proposal, not an active rule.'
from public.seasons s
where kr.season_id = s.id
  and s.year = 2026;

update public.seasons
set canonical_currency = 'NIS',
    buy_in_nis = 350,
    weekly_high_score_nis = 45,
    usd_nis_rate = 3.15,
    usd_rate_locked_at = null,
    auction_budget_usd = 200
where year = 2026;
