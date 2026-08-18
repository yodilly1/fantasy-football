-- Allow the commissioner to remove an accidentally confirmed draft time
-- while the league is still collecting availability.
create or replace function public.clear_draft_time(target_season uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_season_commissioner(target_season) then
    raise exception 'Commissioner access required';
  end if;

  update public.draft_options
  set selected = false
  where season_id = target_season and selected;

  return true;
end;
$$;

revoke all on function public.clear_draft_time(uuid) from public, anon;
grant execute on function public.clear_draft_time(uuid) to authenticated;
