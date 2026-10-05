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
create schema if not exists storage;

-- Supabase's postgres role carries these, so every object a migration creates
-- in `public` is GRANTed to the client roles before RLS is consulted. Without
-- them a local run refuses service_role at the privilege layer and the tests
-- that prove "RLS, not a missing GRANT, is what keeps clients out" fail for the
-- wrong reason. Statements before the migrations: default privileges only apply
-- to objects created after they are set.
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- auth.users is only ever referenced as a foreign key target and by the
-- admin dossier, so the stub carries just the columns those read.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  phone              text,
  phone_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
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

-- The storage catalog, shaped like Supabase's. 0009 creates the chat-media
-- bucket and grants on storage.objects, so without these two tables the
-- migration stops at the first statement that is not a no-op. Only the columns
-- the migrations actually touch are here.
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  metadata   jsonb
);

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to service_role;
grant select, insert, update, delete on storage.objects to service_role;

-- Supabase provisions this publication on every project.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;