-- The beta's database (docs/BETA.md, "Database").
--
-- Clients use the anon key and see only their own rows. Edge Functions use the service
-- role. ESPN cookies never sit in a table: credentials holds a Vault secret id, and only
-- service_role may call the functions that read or write the secret.
--
-- Supabase grants every new public table and function to anon and authenticated by
-- default, so each object below starts by revoking that and grants back only what the
-- contract allows.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'espn',
  secret_id uuid not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  -- Lets connections prove their credential belongs to the same user.
  unique (id, user_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id uuid not null,
  provider text not null default 'espn',
  league_id text not null,
  season int not null,
  team_id text,
  team_name text,
  league_name text,
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'paused')),
  authority text not null default 'ask_me' check (authority in ('alerts', 'ask_me', 'bench_protection', 'ai_rescue')),
  bench_swaps boolean not null default true,
  replacement_order text[] not null default '{}',
  max_auto_moves_per_day int not null default 3 check (max_auto_moves_per_day >= 0),
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_roster jsonb,
  last_roster_at timestamptz,
  -- When a change the user made through HangoverBot (the test swap, or an approval) was
  -- last seen on a fresh read. The first automatic move in a league waits for it.
  write_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, league_id, season),
  foreign key (credential_id, user_id) references public.credentials (id, user_id) on delete cascade
);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  finding_key text not null,
  period int not null,
  kind text not null check (kind in ('notify', 'wait', 'propose', 'ask_user', 'execute')),
  status text not null check (status in ('pending', 'approved', 'declined', 'expired', 'superseded', 'done', 'failed')),
  moves jsonb not null default '[]',
  summary text not null,
  reason text not null,
  deadline timestamptz,
  auto_at timestamptz,
  signature text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb
);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references public.connections (id) on delete cascade,
  type text not null check (type in (
    'STATUS_CHANGED', 'ACTION_REQUIRED', 'ACTION_RECOMMENDED', 'ACTION_COMPLETED', 'ACTION_FAILED', 'PREGAME_WARNING'
  )),
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  -- Defaults to the caller so the app's upsert does not have to send it.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The checker's query, every minute.
create index connections_due on public.connections (next_check_at) where status in ('active', 'needs_reauth');
create index connections_user on public.connections (user_id);
create index connections_credential on public.connections (credential_id, user_id);

-- Dedupe reads every action for one finding in one period.
create index actions_finding on public.actions (connection_id, finding_key, period);
create index actions_user on public.actions (user_id, created_at desc);
-- The daily automatic-move count, by when the write was started: one still in flight counts.
create index actions_auto_moves on public.actions (connection_id, created_at) where kind = 'execute';
-- Proposals waiting and writes in flight, settled and withdrawn at every check.
create index actions_open on public.actions (connection_id, created_at) where status in ('pending', 'approved');

create index activity_user on public.activity (user_id, created_at desc);
create index activity_connection on public.activity (connection_id);

create index devices_user on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.credentials enable row level security;
alter table public.connections enable row level security;
alter table public.actions enable row level security;
alter table public.activity enable row level security;
alter table public.devices enable row level security;

revoke all on public.credentials, public.connections, public.actions, public.activity, public.devices from anon, authenticated;
grant all on public.credentials, public.connections, public.actions, public.activity, public.devices to service_role;

-- credentials: own rows, and never secret_id. A client select must name its columns;
-- select('*') is refused because of this.
grant select (id, user_id, provider, status, created_at, updated_at) on public.credentials to authenticated;
create policy credentials_select_own on public.credentials
  for select to authenticated using (user_id = (select auth.uid()));

-- connections: read own; change only the user's own settings. Which status changes
-- are allowed is enforced by connections_client_update below, because a policy cannot
-- see the old row.
grant select on public.connections to authenticated;
grant update (authority, bench_swaps, replacement_order, status) on public.connections to authenticated;
create policy connections_select_own on public.connections
  for select to authenticated using (user_id = (select auth.uid()));
create policy connections_update_own on public.connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.actions to authenticated;
create policy actions_select_own on public.actions
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.activity to authenticated;
create policy activity_select_own on public.activity
  for select to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.devices to authenticated;
create policy devices_select_own on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy devices_insert_own on public.devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update_own on public.devices
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete_own on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger credentials_touch before update on public.credentials
  for each row execute function public.touch_updated_at();
create trigger devices_touch before update on public.devices
  for each row execute function public.touch_updated_at();

-- A client may pause and resume. Only signing in to ESPN again (espn-connect) clears
-- needs_reauth; otherwise the checker would just fail again and re-alert.
create function public.connections_client_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status then
    if new.status not in ('active', 'paused') then
      raise exception 'status can only be set to active or paused' using errcode = 'check_violation';
    end if;
    if old.status = 'needs_reauth' and new.status = 'active' then
      raise exception 'sign in to ESPN again to resume this league' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger connections_client_update before update on public.connections
  for each row execute function public.connections_client_update();

-- A push token belongs to whoever is signed in on that phone now. Without this, a new
-- anonymous user on the same phone could not register it (the old row is invisible to
-- them) and the previous user's alerts would keep arriving there.
create function public.devices_take_token() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.devices where expo_push_token = new.expo_push_token and user_id <> new.user_id;
  return new;
end;
$$;

create trigger devices_take_token before insert on public.devices
  for each row execute function public.devices_take_token();

-- Deleting a credential (or its user) takes the cookies out of Vault with it. A failure
-- here must not block deleting an account, so it warns instead.
create function public.credentials_drop_secret() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from vault.secrets where id = old.secret_id;
  exception when others then
    raise warning 'credential %: vault secret not removed (%)', old.id, sqlstate;
  end;
  return old;
end;
$$;

create trigger credentials_drop_secret after delete on public.credentials
  for each row execute function public.credentials_drop_secret();

revoke execute on function public.touch_updated_at(), public.connections_client_update(),
  public.devices_take_token(), public.credentials_drop_secret() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vault functions: service_role only
-- ---------------------------------------------------------------------------

-- Create or replace the user's credential for this provider. Only swid and espnS2 are
-- kept, whatever else the caller sent.
create function public.store_credential(p_user uuid, p_provider text, p_secret jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_secret_id uuid;
  v_value text;
begin
  if p_user is null or coalesce(p_provider, '') = '' then
    raise exception 'user and provider are required' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_secret ->> 'swid', '') = '' or coalesce(p_secret ->> 'espnS2', '') = '' then
    raise exception 'secret needs swid and espnS2' using errcode = 'invalid_parameter_value';
  end if;
  v_value := jsonb_build_object('swid', p_secret ->> 'swid', 'espnS2', p_secret ->> 'espnS2')::text;

  select c.id, c.secret_id into v_id, v_secret_id
    from public.credentials c
    where c.user_id = p_user and c.provider = p_provider
    for update;

  if v_id is null then
    v_id := gen_random_uuid();
    v_secret_id := vault.create_secret(v_value, 'credential/' || v_id::text, p_provider || ' sign-in');
    insert into public.credentials (id, user_id, provider, secret_id, status)
      values (v_id, p_user, p_provider, v_secret_id, 'active');
  elsif exists (select 1 from vault.decrypted_secrets s where s.id = v_secret_id) then
    perform vault.update_secret(v_secret_id, v_value);
    update public.credentials set status = 'active' where id = v_id;
  else
    -- The secret was removed by hand: start a new one rather than update nothing.
    v_secret_id := vault.create_secret(v_value, null, p_provider || ' sign-in');
    update public.credentials set secret_id = v_secret_id, status = 'active' where id = v_id;
  end if;

  return v_id;
end;
$$;

-- {"swid": ..., "espnS2": ...}, or null when there is no such credential.
create function public.read_credential(p_credential uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret::jsonb
  from public.credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.id = p_credential;
$$;

-- An anonymous account never gets unattended writes (core.effectiveAuthority).
-- A missing user is not claimed.
create function public.account_claimed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not u.is_anonymous from auth.users u where u.id = p_user), false);
$$;

revoke execute on function public.store_credential(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.read_credential(uuid) from public, anon, authenticated;
revoke execute on function public.account_claimed(uuid) from public, anon, authenticated;
grant execute on function public.store_credential(uuid, text, jsonb) to service_role;
grant execute on function public.read_credential(uuid) to service_role;
grant execute on function public.account_claimed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The scheduled checker
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- project_url and cron_secret are Vault secrets added at deploy time (docs/DEPLOY.md).
-- They are read on every run, so rotating either needs no migration. Until both exist
-- the job sends nothing.
-- The checker answers only when its run is over, so the request waits for it rather
-- than pg_net's 5 second default.
select cron.unschedule(jobid) from cron.job where jobname = 'hangoverbot-check';
select cron.schedule(
  'hangoverbot-check',
  '* * * * *',
  $cron$
  select net.http_post(
    url := rtrim(s.url, '/') || '/functions/v1/check',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret') as secret
  ) s
  where s.url is not null and s.secret is not null;
  $cron$
);
