<#
.SYNOPSIS
  Applies the outstanding Supabase migrations for Steadfast (0003 and 0004).

.DESCRIPTION
  The service-role key cannot run DDL, and the SQL editor needs manual copy/paste.
  This script connects straight to Postgres instead, so both migrations land in one
  go and can be re-run safely after a password change.

  The database password is read as a SecureString and passed to psql through the
  PGPASSWORD environment variable, so it is never written to disk, never echoed,
  and never lands in this repo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-migrations.ps1

.EXAMPLE
  # Skip the password prompt if PGPASSWORD is already set in the environment.
  powershell -ExecutionPolicy Bypass -File .\scripts\apply-migrations.ps1
#>

[CmdletBinding()]
param(
  # Override the auto-detected project ref if you have more than one Supabase project.
  [string]$ProjectRef,

  # Migrations to apply, in order.
  [string[]]$Migrations = @(
    "0003_phone_identity.sql",
    "0004_admin_dossier.sql",
    "0005_webauthn_passkeys.sql"
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

$verifySql = @"
select
  'webauthn_credentials=' || case when to_regclass('public.webauthn_credentials') is null then 'MISSING' else 'present' end,
  'webauthn_challenges=' || case when to_regclass('public.webauthn_challenges') is null then 'MISSING' else 'present' end,
  'normalize_phone='   || case when to_regproc('private.normalize_phone') is null then 'MISSING' else 'present' end,
  'profiles_phone='    || case when exists (
                                select 1 from information_schema.columns
                                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone'
                              ) then 'present' else 'MISSING' end,
  'passkey_rpc='       || case when to_regproc('public.passkey_user_id_for_phone') is null then 'MISSING' else 'present' end,
  'admin_dossier_rpc='|| case when to_regproc('public.get_admin_user_detail') is null then 'MISSING' else 'present' end;
"@

$check = & $psql.Source `
  --host=$hostName --port=5432 --username=postgres --dbname=postgres `
  --no-align --tuples-only --quiet `
  --command="$verifySql"

Write-Host "  $check" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Done. The fingerprint sign-in appears on /login on its own - no redeploy needed." -ForegroundColor Green