alter table public.season_team_budgets
  add column if not exists locked_at timestamptz;

create or replace function public.prevent_locked_keeper_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_season uuid := coalesce(new.season_id, old.season_id);
  target_team uuid := coalesce(new.team_id, old.team_id);
begin
  if exists (
    select 1 from public.season_team_budgets b
    where b.season_id = target_season and b.team_id = target_team and b.status = 'keepers_locked'
  ) then
    raise exception 'Keeper selections are locked. Ask the commissioner to reopen them.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists keeper_selection_lock_guard on public.keeper_selections;
create trigger keeper_selection_lock_guard
before insert or update or delete on public.keeper_selections
for each row execute function public.prevent_locked_keeper_change();

create or replace function public.prevent_budget_unlock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'keepers_locked' and new.status <> 'keepers_locked'
     and not public.is_season_commissioner(old.season_id) then
    raise exception 'Keeper selections are locked. Ask the commissioner to reopen them.';
  end if;
  return new;
end;
$$;

drop trigger if exists keeper_budget_lock_guard on public.season_team_budgets;
create trigger keeper_budget_lock_guard
before update on public.season_team_budgets
for each row execute function public.prevent_budget_unlock();

create or replace function public.lock_keeper_selections(target_season uuid, target_team uuid)
returns public.season_team_budgets
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.season_team_budgets;
begin
  if not exists (
    select 1 from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    where tm.season_id = target_season and tm.team_id = target_team and m.auth_user_id = auth.uid()
  ) then
    raise exception 'You do not manage this team for the selected season';
  end if;
  if not exists (
    select 1 from public.player_ownership_history h
    where h.season_id = target_season and h.team_id = target_team
  ) then
    raise exception 'The commissioner must sync the roster before keepers can be locked';
  end if;

  update public.season_team_budgets
     set status = 'keepers_locked', locked_at = now()
   where season_id = target_season and team_id = target_team
   returning * into result;
  if result.id is null then raise exception 'Team budget is missing'; end if;
  return result;
end;
$$;

create or replace function public.reopen_keeper_selections(target_season uuid, target_team uuid)
returns public.season_team_budgets
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.season_team_budgets;
begin
  if not public.is_season_commissioner(target_season) then raise exception 'Commissioner access required'; end if;
  update public.season_team_budgets
     set status = case when keeper_spend_usd > 0 then 'keepers_open' else 'rollforward_pending' end,
         locked_at = null
   where season_id = target_season and team_id = target_team
   returning * into result;
  return result;
end;
$$;

revoke all on function public.lock_keeper_selections(uuid, uuid) from public, anon;
revoke all on function public.reopen_keeper_selections(uuid, uuid) from public, anon;
grant execute on function public.lock_keeper_selections(uuid, uuid) to authenticated;
grant execute on function public.reopen_keeper_selections(uuid, uuid) to authenticated;

