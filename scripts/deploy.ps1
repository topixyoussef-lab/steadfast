# Deploys to Vercel production and moves the live hostname onto the deployment
# that was just created.
#
#   powershell -File scripts\deploy.ps1
#
# The Vercel project has no GitHub integration, so a push deploys nothing and
# this is the whole release. It is two commands because Vercel will not do the
# second one on its own: a fresh production deployment only ever claims
# steadfast-velo6.vercel.app, while steadfast-lake-eta.vercel.app (the hostname
# the TWA, assetlinks.json and the web manifest all point at) stays pinned to
# whatever deployment was live before. Publishing vercel.json with an "alias" for
# it changes nothing; the CLI ignores the key and claims nothing silently. That
# gap is how a fixed APK sat on main for hours while the domain kept serving the
# build before it, so the alias is assigned explicitly here and then checked.
#
# Keep this file ASCII. Windows PowerShell reads a BOM-less file as the console
# code page, where the three bytes of an em-dash end in 0x94, a curly quote that
# PowerShell accepts as a string delimiter: one of them swallows the rest of the
# file and the script fails to parse.
#
# Options:
#   -Alias       Hostname to move onto the new deployment.
#   -SkipAlias   Deploy only. Use when the domain is deliberately being left on
#                an older deployment.
#   -WhatIf      Print what would run without deploying.

param(
  [string]$Alias = "steadfast-lake-eta.vercel.app",
  [switch]$SkipAlias,
  [switch]$WhatIf
)

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$apk = Join-Path $root "public\steadfast.apk"

$vercel = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercel) {
  Write-Output "vercel not found on PATH."
  exit 1
}

if (-not (Test-Path $apk)) {
  Write-Output "public\steadfast.apk is missing. Build and copy it before deploying;"
  Write-Output "see the README section on icons and the installable app."
  exit 1
}

$expected = (Get-Item $apk).Length
Write-Output "== local APK is $expected bytes =="

if ($WhatIf) {
  Write-Output "would run: vercel --prod"
  if (-not $SkipAlias) { Write-Output "would then run: vercel alias set <new deployment> $Alias" }
  exit 0
}

Push-Location $root
try {
  Write-Output "== deploying =="
  $out = & $vercel.Source --prod --yes 2>&1 | Out-String
}
finally {
  Pop-Location
}

if ($LASTEXITCODE -ne 0) {
  Write-Output ($out -split "`r?`n" | Select-Object -Last 20)
  Write-Output "DEPLOY FAILED"
  exit 1
}

# The CLI prints the production URL twice, once before the build and once after
# it is uploaded; both are the same deployment, so the first match is enough.
$match = [regex]::Match($out, "Production\s+(https://\S+)")
if (-not $match.Success) {
  Write-Output "could not find the production URL in the deploy output."
  Write-Output ($out -split "`r?`n" | Select-Object -Last 20)
  exit 1
}
$deployment = $match.Groups[1].Value.Trim()
Write-Output "== deployed: $deployment =="

if (-not $SkipAlias) {
  Write-Output "== pointing $Alias at it =="
  "y" | & $vercel.Source alias set $deployment $Alias 2>&1 |
    Where-Object { $_ -match "Success|Error|error|already" }
  if ($LASTEXITCODE -ne 0) {
    Write-Output "ALIAS FAILED: $Alias is still serving the previous deployment."
    exit 1
  }
}

# Trust nothing: read the APK back off the domain the members actually use. A
# stale alias returns 200 with the old file, so the status code alone proves
# nothing.
Write-Output "== checking $Alias =="
$live = $null
for ($i = 1; $i -le 6; $i++) {
  try {
    $live = Invoke-WebRequest -Uri "https://$Alias/steadfast.apk" -Method Head -UseBasicParsing -TimeoutSec 30
    break
  }
  catch {
    Write-Output "  attempt $i failed: $($_.Exception.Message)"
    Start-Sleep -Seconds 10
  }
}

if (-not $live) {
  Write-Output "VERIFY FAILED: $Alias did not answer at all."
  exit 1
}

$got = [int64]($live.Headers["Content-Length"] | Select-Object -First 1)
Write-Output "  status $($live.StatusCode), Content-Length $got, expected $expected"
if ($got -ne $expected) {
  Write-Output "VERIFY FAILED: $Alias is serving a different APK than the committed one."
  Write-Output "  re-run the alias assignment by hand before calling the release live."
  exit 1
}

Write-Output "OK: https://$Alias is serving the APK from this commit"