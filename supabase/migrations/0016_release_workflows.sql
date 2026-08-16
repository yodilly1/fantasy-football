-- Release workflows: decisive voting, auditable proposal alerts, and
-- server-calculated NIS/USD settlement credit.

alter table public.proposals
  add column if not exists alert_sent_at timestamptz,
  add column if not exists alert_recipient_count int not null default 0,
  add column if not exists alert_error text;

create or replace function public.update_proposal_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_proposal uuid := coalesce(new.proposal_id, old.proposal_id);
  yes_count int;
  required_count int;
begin
  select count(*) filter (where v.choice = 'yes'), p.required_yes_votes
    into yes_count, required_count
  from public.proposals p
  left join public.votes v on v.proposal_id = p.id
  where p.id = target_proposal
  group by p.required_yes_votes;

  if coalesce(yes_count, 0) >= coalesce(required_count, 7) then
    update public.proposals set status = 'passed' where id = target_proposal and status = 'open';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists proposal_result_after_vote on public.votes;
create trigger proposal_result_after_vote
after insert or update or delete on public.votes
for each row execute function public.update_proposal_result();

drop policy if exists "managers can change own vote" on public.votes;
create policy "managers can change own vote" on public.votes
  for update to authenticated
  using (
    manager_id = public.current_manager_id()
    and exists (select 1 from public.proposals p where p.id = proposal_id and p.status = 'open')
  )
  with check (
    manager_id = public.current_manager_id()
    and exists (select 1 from public.proposals p where p.id = proposal_id and p.status = 'open')
  );

create unique index if not exists one_settlement_per_manager_obligation
  on public.settlements (obligation_id, payer_manager_id);

create or replace function public.submit_settlement(
  target_obligation uuid,
  paid_currency public.payment_currency,
  paid_amount numeric,
  nis_per_usd numeric default null
)
returns public.settlements
language plpgsql
security definer
set search_path = public
as $$
declare
  obligation public.league_obligations;
  credited numeric(12,2);
  submitted public.settlements;
begin
  select * into obligation from public.league_obligations where id = target_obligation;
  if obligation.id is null then raise exception 'Obligation not found'; end if;
  if obligation.manager_id <> public.current_manager_id() then raise exception 'This is not your obligation'; end if;
  if paid_amount <= 0 then raise exception 'Payment amount must be positive'; end if;
  if paid_currency = 'USD' and coalesce(nis_per_usd, 0) <= 0 then raise exception 'Enter the NIS-per-USD rate'; end if;

  credited := round(case when paid_currency = 'USD' then paid_amount * nis_per_usd else paid_amount end, 2);
  if abs(credited - obligation.amount_nis) > 1 then
    raise exception 'Payment must credit the full ₪% obligation (currently ₪%)', obligation.amount_nis, credited;
  end if;

  insert into public.settlements (
    obligation_id, payer_manager_id, recipient_manager_id, payment_currency,
    payment_amount, exchange_rate_nis_per_usd, credited_nis, status, paid_at
  ) values (
    obligation.id, obligation.manager_id, obligation.recipient_manager_id,
    paid_currency, paid_amount,
    case when paid_currency = 'USD' then nis_per_usd else null end,
    credited, 'submitted', now()
  )
  returning * into submitted;
  return submitted;
end;
$$;

revoke all on function public.submit_settlement(uuid, public.payment_currency, numeric, numeric) from public, anon;
grant execute on function public.submit_settlement(uuid, public.payment_currency, numeric, numeric) to authenticated;

