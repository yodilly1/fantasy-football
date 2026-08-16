-- Publicly readable league reference data.
create policy "public can read seasons" on public.seasons for select using (true);
create policy "public can read teams" on public.teams for select using (true);
create policy "public can read players" on public.players for select using (true);
create policy "public can read keeper rules" on public.keeper_rules for select using (true);
create policy "public can read proposals" on public.proposals for select using (true);
create policy "public can read awards" on public.awards for select using (true);
create policy "public can read season records" on public.season_records for select using (true);
create policy "public can read draft options" on public.draft_options for select using (true);

-- Authenticated members can read league operations. Writes will be mediated by
-- authenticated app actions after manager identity is connected.
create policy "members can read managers" on public.managers for select to authenticated using (true);
create policy "members can read memberships" on public.team_memberships for select to authenticated using (true);
create policy "members can read ownership history" on public.player_ownership_history for select to authenticated using (true);
create policy "members can read keeper selections" on public.keeper_selections for select to authenticated using (true);
create policy "members can read availability" on public.availability_blocks for select to authenticated using (true);
create policy "members can read votes" on public.votes for select to authenticated using (true);
create policy "members can read obligations" on public.league_obligations for select to authenticated using (true);
create policy "members can read settlements" on public.settlements for select to authenticated using (true);
