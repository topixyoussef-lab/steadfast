-- Fingerprint / passkey second factor (WebAuthn).
--
-- Passwords remain the primary factor. Supabase has no native passkey support,
-- so the authenticator material lives here and the app verifies the assertion
-- in Node before it ever calls supabase.auth.signInWithPassword. The Supabase
-- session is therefore only minted once BOTH factors have passed.
--
-- Both tables are read/written exclusively through the service-role client in
-- src/lib/webauthn-server.ts. No RLS policy grants the anon/authenticated roles
-- access, so PostgREST cannot reach them even if a token were forged.

create table if not exists public.webauthn_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  credential_id   text not null unique,
  public_key      bytea not null,
  counter         bigint not null default 0,
  transports      text[],
  device_type     text,
  backed_up       boolean not null default false,
  label           text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);

create index if not exists webauthn_credentials_user_id_idx
  on public.webauthn_credentials (user_id);

-- Single-use challenges. Serverless instances do not share memory, so the
-- pending challenge has to live in the database or an assertion could be
-- replayed across two different lambdas.
create table if not exists public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,
  challenge   text not null,
  purpose     text not null check (purpose in ('auth', 'register')),
  expires_at  timestamptz not null default now() + interval '5 minutes',
  created_at  timestamptz not null default now()
);

create index if not exists webauthn_challenges_expires_at_idx
  on public.webauthn_challenges (expires_at);

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;

-- Intentional: no policies. Access is service-role only.

-- Housekeeping helper. Safe to call from the app; it only deletes expired rows.
create or replace function private.prune_webauthn_challenges()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.webauthn_challenges where expires_at < now();
$$;

revoke all on function private.prune_webauthn_challenges() from public, anon, authenticated;
grant execute on function private.prune_webauthn_challenges() to service_role;

-- Resolves an email to a user id so passwordless sign-in can bind a WebAuthn
-- challenge to a real account before any credential is checked.
--
-- Lives in `public` because PostgREST only exposes that schema for RPC, and it is
-- callable ONLY by service_role: the callers in src/app/actions/passkey.ts already
-- proved possession of an enrolled private key, so this lookup never turns into a
-- general account-enumeration endpoint.
create or replace function public.passkey_user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.passkey_user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.passkey_user_id_for_email(text) to service_role;