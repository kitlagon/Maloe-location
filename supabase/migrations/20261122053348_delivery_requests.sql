create table public.delivery_requests (
  id uuid primary key,
  created_at timestamptz not null default now(),
  customer_name text not null,
  email text not null,
  phone text not null,
  address text not null,
  notes text not null default '',
  delivery_date date not null,
  pickup_date date not null check (pickup_date >= delivery_date),
  delivery_time time,
  pickup_time time,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  rental_total numeric(12,2) not null check (rental_total >= 30),
  handled_at timestamptz
);

alter table public.delivery_requests enable row level security;
revoke all on public.delivery_requests from public, anon, authenticated;
grant select, insert on public.delivery_requests to service_role;
grant select, update (handled_at) on public.delivery_requests to authenticated;

create policy delivery_requests_admin_read on public.delivery_requests
  for select to authenticated using ((select public.is_admin()));
create policy delivery_requests_admin_update on public.delivery_requests
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create index delivery_requests_created_at_idx on public.delivery_requests (created_at desc);

alter table public.admin_push_events
  alter column reservation_id drop not null,
  add column delivery_request_id uuid unique references public.delivery_requests(id) on delete cascade,
  drop constraint admin_push_events_kind_check,
  add constraint admin_push_events_kind_check check (
    (kind in ('paid', 'cancelled', 'return') and reservation_id is not null and delivery_request_id is null)
    or (kind = 'delivery' and reservation_id is null and delivery_request_id is not null)
  );

create function public.queue_delivery_request_push() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.admin_push_events (delivery_request_id, kind, due_at)
  values (new.id, 'delivery', now());
  return new;
end;
$$;

revoke execute on function public.queue_delivery_request_push() from public, anon, authenticated;
create trigger queue_delivery_request_push
  after insert on public.delivery_requests
  for each row execute function public.queue_delivery_request_push();
