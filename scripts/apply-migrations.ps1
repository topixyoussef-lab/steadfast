<#
.SYNOPSIS
  Applies the outstanding Supabase migrations for Steadfast (0006 through 0009).

.DESCRIPTION
  The service-role key cannot run DDL, and the SQL editor needs manual copy/paste.
  This script connects straight to Postgres instead, so every migration lands in one
  go and can be re-run safely after a password change.

  The database password is read as a SecureString and passed to psql through the
  PGPASSWORD environment variable, so it is never written to disk, never echoed,
  and never lands in this repo.

  Every migration in the default set is written to be re-runnable: columns use
  add column if not exists, policies and triggers are dropped before they are
  created, and the storage bucket insert is an upsert. Running this twice is
  therefore a no-op rather than an error, which is what makes a partial run
  recoverable -- a failure leaves the earlier files applied, and the fix is to
  run this again.

  ON_ERROR_STOP is on, so a migration that fails aborts immediately and nothing
  after it is applied. Read the error before re-running it: it is usually this
  migration meeting a shape the previous one left behind, not a syntax problem.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-migrations.ps1

.EXAMPLE
  # Skip the password prompt if PGPASSWORD is already set in the environment.
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-migrations.ps1

.EXAMPLE
  # Re-apply only the chat media migration.
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-migrations.ps1 -Migrations 0009_chat_media_and_room_locks.sql
#>

[CmdletBinding()]
param(
  # Override the auto-detected project ref if you have more than one Supabase project.
  [string]$ProjectRef,

  # Migrations to apply, in order.
  [string[]]$Migrations = @(
    "0006_chat_upgrades.sql",
    "0007_moderation_log_delete.sql",
    "0008_notifications_delete.sql",
    "0009_chat_media_and_room_locks.sql"
  )
)

$ErrorActionPreference = "Stop"

function Get-ProjectRef {
  if ($ProjectRef) { return $ProjectRef }

  $envFile = Join-Path $PSScriptRoot "..\.env.local"
  if (-not (Test-Path $envFile)) {
    throw "Cannot find .env.local at $envFile - run this from inside the repo."
  }

  $line = Select-String -Path $envFile -Pattern '^NEXT_PUBLIC_SUPABASE_URL=https://([a-z0-9]+)\.supabase\.co' |
    Select-Object -First 1

  if (-not $line) {
    throw "Could not read the project ref from NEXT_PUBLIC_SUPABASE_URL in .env.local."
  }

  return $line.Matches[0].Groups[1].Value
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw "psql not found. Install PostgreSQL client tools, or paste the SQL into the Supabase SQL editor by hand."
}

$ref = Get-ProjectRef
$hostName = "db.$ref.supabase.co"

if (-not $env:PGPASSWORD) {
  Write-Host ""
  Write-Host "Supabase project : $ref" -ForegroundColor Cyan
  Write-Host "Database host    : $hostName" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Find this password under Supabase Dashboard > Settings > Database > Connection string." -ForegroundColor Yellow
  Write-Host "It stays in memory only: it is not saved, not echoed, and never committed." -ForegroundColor Yellow
  Write-Host ""
  $env:PGPASSWORD = Read-Host "Database password" -AsSecureString |
    ForEach-Object { [System.Net.NetworkCredential]::new("", $_).Password }
}

$migrationDir = Join-Path $PSScriptRoot "..\supabase\migrations"

foreach ($name in $Migrations) {
  $path = Join-Path $migrationDir $name
  if (-not (Test-Path $path)) {
    throw "Migration not found: $path"
  }

  Write-Host ""
  Write-Host "Applying $name ..." -ForegroundColor Cyan

  & $psql.Source `
    --host=$hostName `
    --port=5432 `
    --username=postgres `
    --dbname=postgres `
    --set=ON_ERROR_STOP=1 `
    --quiet `
    --file="$path"

  if ($LASTEXITCODE -ne 0) {
    throw "$name failed. Nothing after it was applied."
  }

  Write-Host "  OK  $name" -ForegroundColor Green
}

Write-Host ""
Write-Host "Verifying ..." -ForegroundColor Cyan

# Everything this script's default set is supposed to have left behind. Written
# as one row per object so a failure names the thing that is missing rather than
# just saying the migration did not stick.
$verifySql = @"
select '0006 reactions='     || case when to_regclass('public.chat_message_reactions') is null then 'MISSING' else 'ok' end
union all select '0007 moderation_log_delete=' || case when to_regproc('private.delete_moderation_log') is null then 'MISSING' else 'ok' end
union all select '0008 notification_delete='    || case when to_regproc('private.delete_notification')  is null then 'MISSING' else 'ok' end
union all select '0009 attachments_table='      || case when to_regclass('public.chat_message_attachments') is null then 'MISSING' else 'ok' end
union all select '0009 attachment_kind='        || case when not exists (select 1 from pg_type where typname = 'attachment_kind') then 'MISSING' else 'ok' end
union all select '0009 claim_rpc='              || case when to_regproc('public.claim_message_attachments') is null then 'MISSING' else 'ok' end
union all select '0009 rooms_chat_locked='      || case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='chat_locked') then 'MISSING' else 'ok' end
union all select '0009 rooms_voice_enabled='    || case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='voice_enabled') then 'MISSING' else 'ok' end
union all select '0009 rooms_media_enabled='    || case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='media_enabled') then 'MISSING' else 'ok' end
union all select '0009 content_range_check='    || case when not exists (select 1 from pg_constraint where conrelid='public.chat_messages'::regclass and conname='chat_messages_content_range') then 'MISSING' else 'ok' end
union all select '0009 attachments_read_policy=' || case when not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_message_attachments' and policyname='attachments_read') then 'MISSING' else 'ok' end
union all select '0009 locked_room_trigger='    || case when not exists (select 1 from pg_trigger where tgname='chat_messages_guard_locked_room') then 'MISSING' else 'ok' end
union all select '0009 room_switch_trigger='     || case when not exists (select 1 from pg_trigger where tgname='rooms_guard_switches') then 'MISSING' else 'ok' end
union all select '0009 chat_media_bucket='      || case when not exists (select 1 from storage.buckets where id='chat-media' and public = false) then 'MISSING' else 'ok' end
union all select '0009 attachments_realtime='    || case when not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='chat_message_attachments') then 'MISSING' else 'ok' end;
"@

$check = & $psql.Source `
  --host=$hostName --port=5432 --username=postgres --dbname=postgres `
  --no-align --tuples-only --quiet `
  --command="$verifySql"

$check | ForEach-Object {
  if ($_ -match 'MISSING') {
    Write-Host "  $_" -ForegroundColor Red
  } else {
    Write-Host "  $_" -ForegroundColor DarkGray
  }
}

if ($check -match 'MISSING') {
  Write-Host ""
  Write-Host "Something did not land. The migrations above are re-runnable, so fix the cause and run this again." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Attachments, room locks and the console switches are live as soon as the app is redeployed." -ForegroundColor Green