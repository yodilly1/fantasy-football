-- Keep the money ledger useful for real-world transfers without requiring a paid
-- payment processor. Managers record how they paid; the commissioner confirms it.
alter table public.settlements
  add column if not exists payment_method text,
  add column if not exists payment_reference text;

create or replace function public.submit_settlement(
  target_obligation uuid,
  paid_currency public.payment_currency,
  paid_amount numeric,
  nis_per_usd numeric default null,
  paid_method text default null,
  paid_reference text default null
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
    payment_amount, exchange_rate_nis_per_usd, credited_nis, payment_method,
    payment_reference, status, paid_at
  ) values (
    obligation.id, obligation.manager_id, obligation.recipient_manager_id,
    paid_currency, paid_amount,
    case when paid_currency = 'USD' then nis_per_usd else null end,
    credited, nullif(trim(paid_method), ''), nullif(trim(paid_reference), ''),
    'submitted', now()
  )
  returning * into submitted;
  return submitted;
end;
$$;

revoke all on function public.submit_settlement(uuid, public.payment_currency, numeric, numeric, text, text) from public, anon;
grant execute on function public.submit_settlement(uuid, public.payment_currency, numeric, numeric, text, text) to authenticated;
