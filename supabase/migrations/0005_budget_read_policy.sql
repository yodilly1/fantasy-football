create policy "members can read season budgets"
on public.season_team_budgets for select
to authenticated
using (true);
