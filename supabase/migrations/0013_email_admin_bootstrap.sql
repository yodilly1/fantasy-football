-- Email-based commissioner bootstrap for the league owner.
-- The allow-list is intentionally separate from auth.users so no service-role key
-- or manual dashboard edit is needed when the commissioner signs in.
create table if not exists public.league_admins (
  email text primary key,
  manager_id uuid not null references public.managers(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.league_admins enable row level security;

insert into public.league_admins (email, manager_id)
select 'clarityce@gmail.com', m.id
from public.managers m
where m.sleeper_username = 'yodilly'
on conflict (email) do update set manager_id = excluded.manager_id;

create or replace function public.bootstrap_commissioner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt()->>'email', ''));
  admin_row public.league_admins;
  manager_row public.managers;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into admin_row
  from public.league_admins
  where lower(email) = current_email;

  if admin_row.manager_id is null then
    return jsonb_build_object('is_admin', false);
  end if;

  update public.managers
     set auth_user_id = auth.uid()
   where id = admin_row.manager_id
   returning * into manager_row;

  update public.team_memberships
     set is_commissioner = true
   where manager_id = admin_row.manager_id;

  return jsonb_build_object(
    'is_admin', true,
    'manager_id', manager_row.id,
    'display_name', manager_row.display_name
  );
end;
$$;

revoke all on public.league_admins from anon, authenticated;
revoke all on function public.bootstrap_commissioner() from anon;
grant execute on function public.bootstrap_commissioner() to authenticated;

-- Friendly post-sign-in team selection for managers who do not use a private
-- invite link. A claimed manager/team cannot be overwritten by another account.
create or replace function public.claim_manager_for_team(target_team uuid)
returns public.managers
language plpgsql
security definer
set search_path = public
as $$
declare
  target_season uuid;
  claimed public.managers;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_season from public.seasons where year = 2026;
  select m.* into claimed
  from public.team_memberships tm
  join public.managers m on m.id = tm.manager_id
  where tm.season_id = target_season
    and tm.team_id = target_team
    and m.auth_user_id is null;
  if claimed.id is null then raise exception 'That team is already claimed'; end if;
  update public.managers set auth_user_id = auth.uid()
   where id = claimed.id and auth_user_id is null
   returning * into claimed;
  if claimed.id is null then raise exception 'That team is already claimed'; end if;
  return claimed;
end;
$$;

revoke execute on function public.claim_manager_for_team(uuid) from anon;
grant execute on function public.claim_manager_for_team(uuid) to authenticated;
