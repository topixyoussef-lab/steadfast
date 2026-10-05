# Rebuilds a throwaway database, applies the Supabase-shaped harness, runs both
# migrations in order, then runs the requested SQL test file.
#
#   powershell -File scripts\verify-db.ps1 supabase\tests\0002_job_loop_test.sql
#
# Options:
#   -TestFile   SQL file executed after the migrations. Omit to stop after migrating.
#   -Psql       Path to psql. Defaults to whatever is on PATH.
#   -Host       Postgres host. Default 127.0.0.1.
#   -Port       Postgres port. Default 5432.
#   -User       Superuser name. Default postgres.
#   -Database   Throwaway database name. Default steadfast_check.
#   -NoSubstitute
#               Skip the `execute function` -> `execute procedure` rewrite. Keep
#               this off for PostgreSQL 11 and newer, including Supabase.

param(
  [string]$TestFile = "",
  [string]$Psql = "",
  [string]$Host_ = "127.0.0.1",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$Database = "steadfast_check",
  [switch]$NoSubstitute
)

$ErrorActionPreference = "Continue"

if ($Psql -eq "") {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Output "psql not found. Pass -Psql <path-to-psql.exe>."
    exit 1
  }
  $Psql = $cmd.Source
}

$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) "steadfast-dbcheck"
New-Item -ItemType Directory -Path $work -Force | Out-Null

$conn = @("-h", $Host_, "-p", "$Port", "-U", $User)

$migrations = @(
  "0001_init",
  "0002_job_loop",
  "0003_phone_identity",
  "0004_admin_dossier",
  "0005_webauthn_passkeys",
  "0006_chat_upgrades",
  "0007_moderation_log_delete",
  "0008_notifications_delete",
  "0009_chat_media_and_room_locks"
)

if (-not $NoSubstitute) {
  Write-Output "== rewriting 'execute function' as 'execute procedure' =="
  Write-Output "== (PostgreSQL 10 only. Pass -NoSubstitute on 11+ and Supabase) =="
}
foreach ($m in $migrations) {
  $src = Get-Content (Join-Path $root "supabase\migrations\$m.sql") -Raw -Encoding UTF8
  if (-not $NoSubstitute) { $src = $src -replace 'execute function', 'execute procedure' }
  Set-Content -Path (Join-Path $work "$m.sql") -Value $src -NoNewline -Encoding UTF8
}

& $Psql @conn -c "drop database if exists $Database" -c "create database $Database" 2>&1 | Select-Object -Last 1

$db = @("-d", $Database)
& $Psql @conn @db -q -v ON_ERROR_STOP=1 -f (Join-Path $root "scripts\harness.sql") 2>&1 | Select-Object -First 8
if ($LASTEXITCODE -ne 0) { Write-Output "HARNESS FAILED"; exit 1 }

foreach ($m in $migrations) {
  & $Psql @conn @db -q -v ON_ERROR_STOP=1 -f (Join-Path $work "$m.sql") 2>&1 |
    Where-Object { $_ -notmatch 'already exists, skipping' } | Select-Object -First 8
  if ($LASTEXITCODE -ne 0) { Write-Output "MIGRATION $m FAILED"; exit 1 }
  Write-Output "migrated: $m"
}

if ($TestFile -ne "") {
  if (-not (Test-Path $TestFile)) { Write-Output "test file not found: $TestFile"; exit 1 }
  Write-Output "running: $TestFile"
  & $Psql @conn @db -q -v ON_ERROR_STOP=1 -f $TestFile 2>&1 |
    Where-Object { $_ -notmatch 'CategoryInfo|FullyQualifiedErrorId|At line|^\s*\+|^\s*$' } | Select-Object -First 25
  Write-Output "TEST_EXIT=$LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Output "migrations applied, no test file given"