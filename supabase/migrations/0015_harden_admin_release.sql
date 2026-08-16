create or replace function public.admin_release_team(target_team uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_season uuid;
  target_manager uuid;
  target_name text;
begin
  select id into target_season from public.seasons where year = 2026;
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;

  select tm.manager_id, t.display_name
    into target_manager, target_name
  from public.team_memberships tm
  join public.teams t on t.id = tm.team_id
  where tm.season_id = target_season and tm.team_id = target_team;

  if target_manager is null then raise exception 'Team not found'; end if;
  if target_manager = public.current_manager_id() then
    raise exception 'The commissioner cannot release their own active team';
  end if;

  update public.managers set auth_user_id = null where id = target_manager;
  return jsonb_build_object('released', true, 'team_id', target_team, 'team_name', target_name);
end;
$$;

revoke all on function public.admin_release_team(uuid) from public, anon;
grant execute on function public.admin_release_team(uuid) to authenticated;
