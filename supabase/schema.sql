create extension if not exists pg_net with schema extensions;

create table if not exists public.admin_status (
  id smallint primary key default 1,
  status text not null default 'in_room'
    check (status in ('in_room', 'out_no_phone', 'out_with_phone', 'university')),
  updated_at timestamptz not null default now(),
  constraint admin_status_single_row check (id = 1)
);

insert into public.admin_status (id, status)
values (1, 'in_room')
on conflict (id) do nothing;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  role text not null default 'admin' check (role in ('admin', 'user')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists devices_role_idx on public.devices (role);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'ping',
  message text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists admin_status_set_updated_at on public.admin_status;
create trigger admin_status_set_updated_at
  before insert or update on public.admin_status
  for each row execute function public.set_updated_at();

alter table public.admin_status enable row level security;
alter table public.devices enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "status_read_all" on public.admin_status;
create policy "status_read_all"
  on public.admin_status for select
  to anon, authenticated
  using (true);

drop policy if exists "status_insert_admin" on public.admin_status;
create policy "status_insert_admin"
  on public.admin_status for insert
  to anon, authenticated
  with check (true);

drop policy if exists "status_update_admin" on public.admin_status;
create policy "status_update_admin"
  on public.admin_status for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "devices_register" on public.devices;
create policy "devices_register"
  on public.devices for insert
  to anon, authenticated
  with check (true);

drop policy if exists "devices_touch" on public.devices;
create policy "devices_touch"
  on public.devices for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "notifications_create" on public.notifications;
create policy "notifications_create"
  on public.notifications for insert
  to anon, authenticated
  with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.admin_status to anon, authenticated;
grant insert, update on public.devices to anon, authenticated;
grant insert on public.notifications to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_status'
  ) then
    alter publication supabase_realtime add table public.admin_status;
  end if;
end $$;

create or replace function public.throttle_pings()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(918273645);

  if exists (
    select 1
    from public.notifications
    where created_at > now() - interval '8 seconds'
  ) then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_throttle on public.notifications;
create trigger notifications_throttle
  before insert on public.notifications
  for each row execute function public.throttle_pings();

create or replace function public.notify_admin_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  function_url text;
  webhook_secret text;
begin
  select decrypted_secret into function_url
  from vault.decrypted_secrets
  where name = 'push_function_url';

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret';

  if function_url is null then
    raise warning 'push_function_url is missing from Vault — push skipped';
    return new;
  end if;

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(webhook_secret, '')
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notify_admin_push();
