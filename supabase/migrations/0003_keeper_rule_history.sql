alter table public.keeper_rules
  add column if not exists universal_floor_usd numeric(12,2),
  add column if not exists adp_exception_enabled boolean not null default false,
  add column if not exists adp_median_usd numeric(12,2),
  add column if not exists adp_extra_tax_usd numeric(12,2);

insert into public.seasons (year, name, status, canonical_currency, buy_in_nis, weekly_high_score_nis, usd_nis_rate, usd_rate_locked_at)
values
  (2024, 'Ugh Who Cares 2024', 'complete', 'NIS', 350, 45, 3.15, '2024-09-01T00:00:00Z'),
  (2025, 'Ugh Who Cares 2025', 'complete', 'NIS', 350, 45, 3.15, '2025-08-01T00:00:00Z'),
  (2026, 'Ugh Who Cares 2026', 'setup', 'NIS', 350, 45, null, null)
on conflict (year) do update set
  name = excluded.name,
  canonical_currency = excluded.canonical_currency,
  buy_in_nis = excluded.buy_in_nis,
  weekly_high_score_nis = excluded.weekly_high_score_nis;

insert into public.keeper_rules (
  season_id, max_keepers, max_keeper_years, keeper_tax_usd, universal_floor_usd,
  rb_floor_usd, wr_floor_usd, adp_exception_enabled, adp_median_usd, adp_extra_tax_usd,
  non_rb_wr_minimum_applies, trade_resets_clock, effective_from_season, notes
)
select s.id, x.max_keepers, x.max_keeper_years, x.keeper_tax_usd, x.universal_floor_usd,
       x.rb_floor_usd, x.wr_floor_usd, x.adp_exception_enabled, x.adp_median_usd, x.adp_extra_tax_usd,
       x.non_rb_wr_minimum_applies, true, x.year, x.notes
from (values
  (2024, 2, 2, 5::numeric, 20::numeric, null::numeric, null::numeric, false, null::numeric, null::numeric, false, '2024 rules: universal $20 floor for most positions; no floor for QB, TE, K, DEF.'),
  (2025, 2, 2, 5::numeric, null::numeric, 13::numeric, 14::numeric, true, 27::numeric, 8::numeric, false, '2025 rules: RB floor $13, WR floor $14; ADP/median exception can add $8; waiver/free-agent keepers cost $5.'),
  (2026, 2, 2, 5::numeric, null::numeric, 13::numeric, 14::numeric, true, 27::numeric, 8::numeric, false, 'Carry-forward draft rule set pending league confirmation; traded players receive a new keeper clock.')
) as x(year, max_keepers, max_keeper_years, keeper_tax_usd, universal_floor_usd, rb_floor_usd, wr_floor_usd, adp_exception_enabled, adp_median_usd, adp_extra_tax_usd, non_rb_wr_minimum_applies, notes)
join public.seasons s on s.year = x.year
on conflict (season_id) do update set
  max_keepers = excluded.max_keepers,
  max_keeper_years = excluded.max_keeper_years,
  keeper_tax_usd = excluded.keeper_tax_usd,
  universal_floor_usd = excluded.universal_floor_usd,
  rb_floor_usd = excluded.rb_floor_usd,
  wr_floor_usd = excluded.wr_floor_usd,
  adp_exception_enabled = excluded.adp_exception_enabled,
  adp_median_usd = excluded.adp_median_usd,
  adp_extra_tax_usd = excluded.adp_extra_tax_usd,
  notes = excluded.notes;
