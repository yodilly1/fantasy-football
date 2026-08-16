-- Authenticated league workflows. All writes are scoped to a season member.
create or replace function public.is_season_member(target_season uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    where tm.season_id = target_season
      and m.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_season_commissioner(target_season uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_memberships tm
    join public.managers m on m.id = tm.manager_id
    where tm.season_id = target_season
      and tm.is_commissioner
      and m.auth_user_id = auth.uid()
  );
$$;

create or replace function public.current_manager_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.managers where auth_user_id = auth.uid() limit 1;
$$;

alter table public.managers enable row level security;
alter table public.team_memberships enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.votes enable row level security;
alter table public.proposals enable row level security;
alter table public.league_obligations enable row level security;
alter table public.settlements enable row level security;
alter table public.keeper_selections enable row level security;
alter table public.season_team_budgets enable row level security;

drop policy if exists "members can read managers" on public.managers;
create policy "members can read managers" on public.managers
  for select to authenticated using (true);

drop policy if exists "members can read memberships" on public.team_memberships;
create policy "members can read memberships" on public.team_memberships
  for select to authenticated using (public.is_season_member(season_id));

drop policy if exists "members can read availability" on public.availability_blocks;
create policy "members can read availability" on public.availability_blocks
  for select to authenticated using (public.is_season_member(season_id));
create policy "managers can add own availability" on public.availability_blocks
  for insert to authenticated with check (manager_id = public.current_manager_id() and public.is_season_member(season_id));
create policy "managers can edit own availability" on public.availability_blocks
  for update to authenticated using (manager_id = public.current_manager_id()) with check (manager_id = public.current_manager_id());
create policy "managers can delete own availability" on public.availability_blocks
  for delete to authenticated using (manager_id = public.current_manager_id());

drop policy if exists "members can read proposals" on public.proposals;
create policy "members can read proposals" on public.proposals
  for select to authenticated using (public.is_season_member(season_id));
create policy "members can create proposals" on public.proposals
  for insert to authenticated with check (author_manager_id = public.current_manager_id() and public.is_season_member(season_id));
create policy "authors can edit draft proposals" on public.proposals
  for update to authenticated using (author_manager_id = public.current_manager_id() and status = 'draft')
  with check (author_manager_id = public.current_manager_id());

drop policy if exists "members can read votes" on public.votes;
create policy "members can read votes" on public.votes
  for select to authenticated using (exists (select 1 from public.proposals p where p.id = proposal_id and public.is_season_member(p.season_id)));
create policy "members can cast own vote" on public.votes
  for insert to authenticated with check (manager_id = public.current_manager_id() and exists (select 1 from public.proposals p where p.id = proposal_id and p.status = 'open' and public.is_season_member(p.season_id)));
create policy "managers can change own vote" on public.votes
  for update to authenticated using (manager_id = public.current_manager_id()) with check (manager_id = public.current_manager_id());

drop policy if exists "members can read obligations" on public.league_obligations;
create policy "members can read obligations" on public.league_obligations
  for select to authenticated using (public.is_season_member(season_id));
create policy "commissioners can create obligations" on public.league_obligations
  for insert to authenticated with check (public.is_season_commissioner(season_id));

drop policy if exists "members can read settlements" on public.settlements;
create policy "members can read settlements" on public.settlements
  for select to authenticated using (exists (select 1 from public.league_obligations o where o.id = obligation_id and public.is_season_member(o.season_id)));
create policy "managers can submit own settlements" on public.settlements
  for insert to authenticated with check (payer_manager_id = public.current_manager_id() and exists (select 1 from public.league_obligations o where o.id = obligation_id and o.manager_id = public.current_manager_id()));
create policy "commissioners can confirm settlements" on public.settlements
  for update to authenticated using (exists (select 1 from public.league_obligations o where o.id = obligation_id and public.is_season_commissioner(o.season_id)))
  with check (true);

drop policy if exists "members can read keeper selections" on public.keeper_selections;
create policy "members can read keeper selections" on public.keeper_selections
  for select to authenticated using (public.is_season_member(season_id));
create policy "managers can choose own keepers" on public.keeper_selections
  for insert to authenticated with check (team_id in (select tm.team_id from public.team_memberships tm join public.managers m on m.id = tm.manager_id where tm.season_id = keeper_selections.season_id and m.auth_user_id = auth.uid()));
create policy "managers can remove own keepers" on public.keeper_selections
  for delete to authenticated using (team_id in (select tm.team_id from public.team_memberships tm join public.managers m on m.id = tm.manager_id where tm.season_id = keeper_selections.season_id and m.auth_user_id = auth.uid()));

drop policy if exists "members can read season budgets" on public.season_team_budgets;
create policy "members can read season budgets" on public.season_team_budgets
  for select to authenticated using (public.is_season_member(season_id));
