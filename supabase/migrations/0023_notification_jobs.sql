-- Queue email notifications in the database so browser timing cannot lose events.

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  kind text not null check (kind in ('proposal_open', 'proposal_passed', 'keeper_deadline')),
  proposal_id uuid references public.proposals(id) on delete cascade,
  draft_option_id uuid references public.draft_options(id) on delete cascade,
  due_at timestamptz not null default now(),
  event_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_jobs_due_idx
  on public.notification_jobs (status, due_at);

alter table public.notification_jobs enable row level security;

create or replace function public.queue_proposal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notification_jobs (season_id, kind, proposal_id, event_key)
    values (new.season_id, 'proposal_open', new.id, 'proposal-open:' || new.id)
    on conflict (event_key) do nothing;
  elsif new.status = 'passed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notification_jobs (season_id, kind, proposal_id, event_key)
    values (new.season_id, 'proposal_passed', new.id, 'proposal-passed:' || new.id)
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists proposal_notification_queue on public.proposals;
create trigger proposal_notification_queue
after insert or update of status on public.proposals
for each row execute function public.queue_proposal_notification();

create or replace function public.queue_keeper_deadline_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.selected and (tg_op = 'INSERT' or not old.selected or old.starts_at is distinct from new.starts_at) then
    delete from public.notification_jobs
    where season_id = new.season_id
      and kind = 'keeper_deadline'
      and status in ('pending', 'failed');

    insert into public.notification_jobs (
      season_id, kind, draft_option_id, due_at, event_key
    ) values (
      new.season_id, 'keeper_deadline', new.id,
      new.starts_at - interval '24 hours',
      'keeper-deadline:' || new.season_id || ':' || new.starts_at
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists draft_deadline_notification_queue on public.draft_options;
create trigger draft_deadline_notification_queue
after insert or update of selected, starts_at on public.draft_options
for each row execute function public.queue_keeper_deadline_notification();

revoke all on public.notification_jobs from anon, authenticated;
