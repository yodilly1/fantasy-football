create table if not exists public.manager_invites (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  invite_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.manager_invites enable row level security;

create unique index if not exists managers_display_name_key on public.managers (display_name);
create unique index if not exists teams_display_name_key on public.teams (display_name);

insert into public.managers (display_name, sleeper_username)
values
  ('Florida Men', 'yodilly'),
  ('Lets Get COOKing', 'jeffsmagley'),
  ('Jordan Love Boat', 'CutAndCav'),
  ('Zenneth Charker', 'Shmoooo'),
  ('Justin Tugger69', 'RodgersThat007'),
  ('EatMyHenry', 'RespectTheSacko'),
  ('Teeing off', 'TheKarenRound4'),
  ('Herb Your Enthusiasm', 'JayB972'),
  ('Mathew''s Golden Cheese Co', 'mjevo97'),
  ('Ayo for Mayeo', 'EnriqueL'),
  ('Scary Terry', 'AshevilleBrews'),
  ('Thirsty for Brock', 'RaaandyMarsh')
on conflict do nothing;

insert into public.teams (display_name, sleeper_team_id)
values
  ('Florida Men', '1'), ('Lets Get COOKing', '2'), ('Jordan Love Boat', '3'),
  ('Zenneth Charker', '4'), ('Justin Tugger69', '5'), ('EatMyHenry', '6'),
  ('Teeing off', '7'), ('Herb Your Enthusiasm', '8'), ('Mathew''s Golden Cheese Co', '9'),
  ('Ayo for Mayeo', '10'), ('Scary Terry', '11'), ('Thirsty for Brock', '12')
on conflict do nothing;

insert into public.team_memberships (season_id, team_id, manager_id, is_commissioner)
select s.id, t.id, m.id, (m.sleeper_username = 'yodilly')
from public.seasons s
join public.teams t on true
join public.managers m on m.display_name = t.display_name
where s.year = 2026
on conflict (season_id, team_id) do update set is_commissioner = excluded.is_commissioner;

insert into public.season_team_budgets (season_id, team_id)
select s.id, t.id from public.seasons s cross join public.teams t
where s.year = 2026
on conflict (season_id, team_id) do nothing;

insert into public.manager_invites (season_id, manager_id)
select s.id, m.id
from public.seasons s cross join public.managers m
where s.year = 2026 and not exists (
  select 1 from public.manager_invites i where i.season_id = s.id and i.manager_id = m.id
);

create or replace function public.claim_manager(invite text)
returns public.managers
language plpgsql
security definer
set search_path = public
as $$
declare claimed public.managers;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.managers m
    set auth_user_id = auth.uid()
    from public.manager_invites i
    where i.invite_token = claim_manager.invite
      and i.manager_id = m.id
      and i.redeemed_at is null
      and m.auth_user_id is null
    returning m.* into claimed;
  if claimed.id is null then raise exception 'Invite is invalid, used, or already claimed'; end if;
  update public.manager_invites set redeemed_at = now() where invite_token = claim_manager.invite;
  return claimed;
end;
$$;

create policy "commissioners can read unredeemed invites" on public.manager_invites
  for select to authenticated using (public.is_season_commissioner(season_id) and redeemed_at is null);
