alter table public.delivery_requests
  add column email_next_attempt_at timestamptz,
  add column email_attempts integer not null default 0,
  add column email_sent_at timestamptz;

alter table public.delivery_requests
  alter column email_next_attempt_at set default now();

grant update (email_next_attempt_at, email_attempts, email_sent_at)
  on public.delivery_requests to service_role;

create index delivery_requests_email_queue_idx
  on public.delivery_requests (email_next_attempt_at)
  where email_sent_at is null and email_attempts < 5;
