-- Import the current Sleeper rollover roster into the relational player tables.
-- Existing ownership rows are preserved so commissioner corrections and trade resets win.
create or replace function public.import_rollover_snapshot(
  target_season uuid,
  snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  season_year int;
  team_item jsonb;
  player_item jsonb;
  target_team uuid;
  target_player uuid;
  inserted_players int := 0;
  inserted_ownership int := 0;
begin
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;

  select year into season_year from public.seasons where id = target_season;
  if season_year is null then raise exception 'Season not found'; end if;

  for team_item in select value from jsonb_array_elements(coalesce(snapshot->'teams', '[]'::jsonb)) loop
    select id into target_team from public.teams where display_name = team_item->>'team_name' limit 1;
    if target_team is null then continue; end if;

    for player_item in select value from jsonb_array_elements(coalesce(team_item->'players', '[]'::jsonb)) loop
      insert into public.players (sleeper_player_id, name, position, nfl_team)
      values (player_item->>'id', player_item->>'name', player_item->>'position', player_item->>'team')
      on conflict (sleeper_player_id) do update set
        name = excluded.name,
        position = excluded.position,
        nfl_team = excluded.nfl_team
      returning id into target_player;
      if target_player is null then
        select id into target_player from public.players where sleeper_player_id = player_item->>'id';
      else
        inserted_players := inserted_players + 1;
      end if;

      if not exists (
        select 1 from public.player_ownership_history h
        where h.season_id = target_season and h.team_id = target_team and h.player_id = target_player
      ) then
        insert into public.player_ownership_history (
          season_id, player_id, team_id, acquisition_type, acquisition_season,
          auction_cost_usd, keeper_clock_start_season, keeper_years_used
        ) values (
          target_season, target_player, target_team, 'rollover', season_year - 1,
          nullif(player_item->>'auction_cost_usd', '')::numeric,
          season_year, coalesce(nullif(player_item->>'keeper_years_used', '')::int, 0)
        );
        inserted_ownership := inserted_ownership + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('players_seen', inserted_players, 'ownership_rows_added', inserted_ownership);
end;
$$;

revoke execute on function public.import_rollover_snapshot(uuid, jsonb) from anon;
grant execute on function public.import_rollover_snapshot(uuid, jsonb) to authenticated;

