-- Replace a manager's keeper set atomically and recalculate the auction budget.
-- The client sends ownership-history IDs, so trades remain tied to the correct clock.
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
  total numeric(12,2) := 0;
  requested_count int := coalesce(jsonb_array_length(selections), 0);
  keeper_year int;
  base_cost numeric(12,2);
  final_cost numeric(12,2);
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

  select coalesce(kr.max_keepers, 2)
    into max_allowed
    from public.keeper_rules kr
   where kr.season_id = target_season;

  if requested_count > coalesce(max_allowed, 2) then
    raise exception 'A team may select at most % keepers', coalesce(max_allowed, 2);
  end if;

  delete from public.keeper_selections
   where season_id = target_season and team_id = target_team;

  for item in select value from jsonb_array_elements(coalesce(selections, '[]'::jsonb)) loop
    select * into ownership
      from public.player_ownership_history h
     where h.id = (item->>'ownership_history_id')::uuid
       and h.season_id = target_season
       and h.team_id = target_team;
    if not found then
      raise exception 'Ownership history does not belong to this team and season';
    end if;

    keeper_year := (item->>'keeper_year_number')::int;
    base_cost := (item->>'base_cost_usd')::numeric;
    final_cost := (item->>'final_cost_usd')::numeric;
    if keeper_year not between 1 and 2 or base_cost < 0 or final_cost < base_cost then
      raise exception 'Invalid keeper cost or keeper year';
    end if;
    if ownership.keeper_years_used >= 2 then
      raise exception 'This player has used the full two-season keeper clock';
    end if;

    insert into public.keeper_selections (
      season_id, team_id, player_id, ownership_history_id,
      base_cost_usd, final_cost_usd, keeper_year_number,
      eligible, eligibility_reason
    ) values (
      target_season, target_team, ownership.player_id, ownership.id,
      base_cost, final_cost, keeper_year,
      true, coalesce(item->>'eligibility_reason', 'Validated by manager in League HQ')
    );
    total := total + final_cost;
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
