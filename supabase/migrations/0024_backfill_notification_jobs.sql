-- Recover notifications for proposals that existed before the queue was installed.
insert into public.notification_jobs (season_id, kind, proposal_id, event_key)
select season_id, 'proposal_open', id, 'proposal-open:' || id
from public.proposals
where status = 'open' and alert_sent_at is null
on conflict (event_key) do nothing;

insert into public.notification_jobs (season_id, kind, proposal_id, event_key)
select season_id, 'proposal_passed', id, 'proposal-passed:' || id
from public.proposals
where status = 'passed' and alert_sent_at is null
on conflict (event_key) do nothing;
