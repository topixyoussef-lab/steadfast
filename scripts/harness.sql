-- Minimal Supabase-shaped harness so the migrations can be syntax and type
-- checked on a plain Postgres. Nothing here ships; it exists so
-- `psql -f 0001_init.sql` does not stop at the first missing auth object.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

-- auth.users is only ever referenced as a foreign key target here.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'anon');
$$;

grant usage on schema auth, public, extensions to anon, authenticated, service_role;

-- Supabase provisions this publication on every project.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;