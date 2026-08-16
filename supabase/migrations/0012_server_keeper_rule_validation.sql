-- Make keeper pricing authoritative in Postgres instead of trusting browser math.
-- The client may provide the inputs (last cost, acquisition type, ADP), but the
-- server recalculates and rejects any mismatched base or final price.

create or replace function public.save_keeper_selections(
  target_season uuid,
  target_team uuid,
  selections jsonb
)
returns setof public.keeper_selections
language plpgsql
security definer
set search_path = public
as $$
declare
  max_allowed int;
  item jsonb;
  ownership public.player_ownership_history;
  player_position text;
  total numeric(12,2) := 0;
  requested_count int := coalesce(jsonb_array_length(selections), 0);
  keeper_year int;
  supplied_last_cost numeric(12,2);
  supplied_adp numeric(12,2);
  supplied_acquisition text;
  expected_base numeric(12,2);
  expected_final numeric(12,2);
  submitted_base numeric(12,2);
  submitted_final numeric(12,2);
  floor_cost numeric(12,2) := 0;
  median_cost numeric(12,2) := 0;
  tax numeric(12,2) := 5;
  adp_extra numeric(12,2) := 8;
  adp_enabled boolean := false;
begin
  if not exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    where tm.season_id = target_season
      and tm.team_id = target_team
      and m.auth_user_id = auth.uid()
  ) then
    raise exception 'You do not manage this team for the selected season';
  end if;

  select coalesce(kr.max_keepers, 2), coalesce(kr.keeper_tax_usd, 5),
         coalesce(kr.adp_extra_tax_usd, 8), coalesce(kr.adp_exception_enabled, false)
    into max_allowed, tax, adp_extra, adp_enabled
    from public.keeper_rules kr
   where kr.season_id = target_season;

  if requested_count > coalesce(max_allowed, 2) then
    raise exception 'A team may select at most % keepers', coalesce(max_allowed, 2);
  end if;

  delete from public.keeper_selections
   where season_id = target_season and team_id = target_team;

  for item in select value from jsonb_array_elements(coalesce(selections, '[]'::jsonb)) loop
    select h.* into ownership
      from public.player_ownership_history h
     where h.id = (item->>'ownership_history_id')::uuid
       and h.season_id = target_season
       and h.team_id = target_team;
    if not found then
      raise exception 'Ownership history does not belong to this team and season';
    end if;

    select p.position into player_position from public.players p where p.id = ownership.player_id;
    keeper_year := (item->>'keeper_year_number')::int;
    supplied_last_cost := coalesce(nullif(item->>'last_cost_usd', '')::numeric, ownership.auction_cost_usd, 0);
    supplied_adp := nullif(item->>'adp_usd', '')::numeric;
    supplied_acquisition := coalesce(nullif(item->>'acquisition_type', ''), ownership.acquisition_type, 'auction');
    submitted_base := (item->>'base_cost_usd')::numeric;
    submitted_final := (item->>'final_cost_usd')::numeric;

    if keeper_year not between 1 and 2 or supplied_last_cost < 0
       or submitted_base is null or submitted_final is null then
      raise exception 'Invalid keeper cost or keeper year';
    end if;
    if ownership.keeper_years_used >= 2 then
      raise exception 'This player has used the full two-season keeper clock';
    end if;

    if supplied_acquisition in ('waiver', 'free_agent') then
      expected_base := 5;
      expected_final := 5;
    else
      expected_base := supplied_last_cost + tax;
      if player_position = 'RB' then
        select coalesce(kr.rb_floor_usd, 0), coalesce(kr.rb_adp_median_usd, kr.adp_median_usd, 0)
          into floor_cost, median_cost from public.keeper_rules kr where kr.season_id = target_season;
      elsif player_position = 'WR' then
        select coalesce(kr.wr_floor_usd, 0), coalesce(kr.wr_adp_median_usd, kr.adp_median_usd, 0)
          into floor_cost, median_cost from public.keeper_rules kr where kr.season_id = target_season;
      else
        floor_cost := 0;
        median_cost := 0;
      end if;
      expected_final := greatest(expected_base, floor_cost);
      if adp_enabled and player_position in ('RB', 'WR') and supplied_adp is not null
         and supplied_adp > median_cost and expected_base < median_cost then
        expected_final := greatest(supplied_last_cost + adp_extra, floor_cost + adp_extra);
      end if;
    end if;

    if abs(submitted_base - expected_base) > 0.01 or abs(submitted_final - expected_final) > 0.01 then
      raise exception 'Keeper price does not match the active league rules for %',
        coalesce((select p.name from public.players p where p.id = ownership.player_id), 'player');
    end if;

    insert into public.keeper_selections (
      season_id, team_id, player_id, ownership_history_id,
      base_cost_usd, final_cost_usd, keeper_year_number,
      eligible, eligibility_reason
    ) values (
      target_season, target_team, ownership.player_id, ownership.id,
      expected_base, expected_final, keeper_year,
      true, coalesce(item->>'eligibility_reason', 'Validated by League HQ rule engine')
    );
    total := total + expected_final;
  end loop;

  update public.season_team_budgets
     set keeper_spend_usd = total,
         status = case when requested_count > 0 then 'keepers_open' else 'rollforward_pending' end
   where season_id = target_season and team_id = target_team;

  return query
    select * from public.keeper_selections
     where season_id = target_season and team_id = target_team
     order by created_at;
end;
$$;

revoke execute on function public.save_keeper_selections(uuid, uuid, jsonb) from anon;
grant execute on function public.save_keeper_selections(uuid, uuid, jsonb) to authenticated;
