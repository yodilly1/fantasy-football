-- Finish the password-free league onboarding and commissioner controls.
-- The browser derives this low-security league password from the email address;
-- this one-time repair brings the commissioner's earlier magic-link account into
-- the same flow without deleting the user or their manager assignment.
update auth.users
set encrypted_password = extensions.crypt('UWC-2026-Y2xhcml0eWNlQGdtYWlsLmNvbQ-league', extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where lower(email) = 'clarityce@gmail.com';

-- An authenticated but unassigned account cannot read team_memberships because
-- of RLS. Expose only the unclaimed team id and name needed for first assignment.
create or replace function public.available_league_teams()
returns table (team_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.display_name
  from public.seasons s
  join public.team_memberships tm on tm.season_id = s.id
  join public.teams t on t.id = tm.team_id
  join public.managers m on m.id = tm.manager_id
  where s.year = 2026
    and m.auth_user_id is null
    and auth.uid() is not null
  order by t.display_name;
$$;

revoke all on function public.available_league_teams() from public, anon;
grant execute on function public.available_league_teams() to authenticated;

-- A commissioner may release a claimed team so its manager can reconnect with
-- a corrected email. No league history or team data is removed.
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
  update public.managers set auth_user_id = null where id = target_manager;
  return jsonb_build_object('released', true, 'team_id', target_team, 'team_name', target_name);
end;
$$;

revoke all on function public.admin_release_team(uuid) from public, anon;
grant execute on function public.admin_release_team(uuid) to authenticated;

-- Select one official draft time atomically. Members may read the result through
-- the existing draft_options read policy; only the commissioner can change it.
create or replace function public.select_draft_time(
  target_season uuid,
  draft_start timestamptz,
  draft_end timestamptz,
  available_count int default 0,
  possible_count int default 0
)
returns public.draft_options
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_row public.draft_options;
begin
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;
  if draft_end <= draft_start then raise exception 'Draft end must be after start'; end if;

  update public.draft_options set selected = false where season_id = target_season and selected;
  insert into public.draft_options (
    season_id, starts_at, ends_at, available_manager_count,
    possible_manager_count, score, selected
  ) values (
    target_season, draft_start, draft_end, greatest(available_count, 0),
    greatest(possible_count, 0), greatest(available_count, 0) * 2 + greatest(possible_count, 0), true
  )
  returning * into selected_row;
  return selected_row;
end;
$$;

revoke all on function public.select_draft_time(uuid, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.select_draft_time(uuid, timestamptz, timestamptz, int, int) to authenticated;
