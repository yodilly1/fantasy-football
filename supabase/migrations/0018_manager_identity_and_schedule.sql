-- Manager-facing identity and replacement controls for the 2026 season.
-- Sleeper history remains immutable; this only updates the league's local display identity.
drop function if exists public.available_league_teams();

create or replace function public.available_league_teams()
returns table (team_id uuid, team_name text, manager_name text, sleeper_username text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.display_name, m.display_name, m.sleeper_username
  from public.seasons s
  join public.team_memberships tm on tm.season_id = s.id
  join public.teams t on t.id = tm.team_id
  join public.managers m on m.id = tm.manager_id
  where s.year = 2026
    and m.auth_user_id is null
    and auth.uid() is not null
  order by m.display_name, t.display_name;
$$;

revoke all on function public.available_league_teams() from public, anon;
grant execute on function public.available_league_teams() to authenticated;

create or replace function public.admin_update_manager_identity(
  target_team uuid,
  new_display_name text,
  new_sleeper_username text default null
)
returns public.managers
language plpgsql
security definer
set search_path = public
as $$
declare
  target_season uuid;
  target_manager uuid;
  updated_manager public.managers;
begin
  select id into target_season from public.seasons where year = 2026;
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;
  if nullif(trim(new_display_name), '') is null then
    raise exception 'Enter the manager name';
  end if;

  select manager_id into target_manager
  from public.team_memberships
  where season_id = target_season and team_id = target_team;
  if target_manager is null then raise exception 'Team not found'; end if;

  update public.managers
  set display_name = trim(new_display_name),
      sleeper_username = nullif(trim(new_sleeper_username), '')
  where id = target_manager
  returning * into updated_manager;
  return updated_manager;
exception
  when unique_violation then
    raise exception 'That manager name is already in use';
end;
$$;

revoke all on function public.admin_update_manager_identity(uuid, text, text) from public, anon;
grant execute on function public.admin_update_manager_identity(uuid, text, text) to authenticated;
