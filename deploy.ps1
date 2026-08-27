# madPlanet safe deploy. Windows PowerShell 5.1 compatible. ASCII-only source.
# Default: rebuild to a temporary file, validate it, then deploy.
# Optional emergency mode: .\deploy.ps1 -NoBuild
[CmdletBinding()]
param(
  [string]$SshHost = 'mimo-update',
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$srcDir = $PSScriptRoot
$indexPath = Join-Path $srcDir 'index.html'
$tmpBuild = Join-Path $srcDir 'index.deploy-build.tmp.html'
$verFile = Join-Path $srcDir 'VERSION.txt'
function Require-Command([string]$Name) {
  if(-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command not found: $Name" }
}
function From-CodePoints([int[]]$CodePoints) {
  $sb = New-Object System.Text.StringBuilder
  foreach($cp in $CodePoints) { [void]$sb.Append([char]$cp) }
  return $sb.ToString()
}
if(-not (Test-Path -LiteralPath $verFile)) { throw 'VERSION.txt not found' }
$verText = [System.IO.File]::ReadAllText($verFile, [System.Text.Encoding]::UTF8)
$m = [regex]::Match($verText, '(?m)^VERSION\s+(\d+\.\d+\.\d+)\s*$')
if(-not $m.Success) { throw 'VERSION.txt must contain VERSION X.Y.Z' }
$version = $m.Groups[1].Value
Write-Host "[madPlanet] version $version"
if($NoBuild) {
  Write-Host '[madPlanet] NoBuild requested: validating existing index.html.'
  $src = $indexPath
} else {
  Write-Host '[madPlanet] Building a fresh temporary index.html before deploy...'
  if(Test-Path -LiteralPath $tmpBuild) { Remove-Item -LiteralPath $tmpBuild -Force }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $srcDir 'build.ps1') -Out $tmpBuild
  if($LASTEXITCODE -ne 0) { throw "build.ps1 failed with exit code $LASTEXITCODE" }
  $src = $tmpBuild
}
if(-not (Test-Path -LiteralPath $src)) { throw "index.html not found: $src" }
$bytes = [System.IO.File]::ReadAllBytes($src)
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
try { $html = $utf8.GetString($bytes) } catch { throw 'index.html is not valid UTF-8' }
$lower = $html.ToLowerInvariant()
if(-not $lower.Contains('<meta charset="utf-8">')) { throw 'index.html has no UTF-8 meta charset' }
$openScripts = ([regex]::Matches($html, '(?i)<script(?:\s|>)')).Count
$closeScripts = ([regex]::Matches($html, '(?i)</script>')).Count
if($openScripts -ne 1 -or $closeScripts -ne 1) { throw "script tag mismatch: open=$openScripts close=$closeScripts" }
if($html -notmatch 'const\s+FRAG\s*=' -or $html -notmatch 'const\s+COMPAT_FRAG\s*=' -or $html -notmatch 'const\s+AURORA_FRAG\s*=') { throw 'embedded shaders missing' }
$versionStamp = "const APP_VERSION = '$version';"
if(-not $html.Contains($versionStamp)) { throw "stale index.html: APP_VERSION is not $version" }
if(-not $html.Contains("<div class=`"ver`">v$version</div>")) { throw "stale index.html: visible version is not $version" }
if($html.IndexOf([char]0xFFFD) -ge 0) { throw 'Unicode replacement character found in index.html' }
$sentinelRandom = From-CodePoints @(0x421,0x43B,0x443,0x447,0x430,0x439,0x43D,0x44B,0x439)
$sentinelShot = From-CodePoints @(0x421,0x43A,0x440,0x438,0x43D,0x448,0x43E,0x442)
if(-not $html.Contains($sentinelRandom) -or -not $html.Contains($sentinelShot)) { throw 'UTF-8 sentinel text missing or corrupted' }
if(-not $NoBuild) {
  [System.IO.File]::WriteAllBytes($indexPath, $bytes)
  Remove-Item -LiteralPath $tmpBuild -Force -ErrorAction SilentlyContinue
  $src = $indexPath
}
Require-Command 'scp'
Require-Command 'ssh'
$hash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant()
$short = $hash.Substring(0,16)
$sizeKB = [math]::Round((Get-Item -LiteralPath $src).Length / 1KB)
Write-Host "[madPlanet] validation OK: version=$version UTF-8 script=1/1 ${sizeKB}KB SHA256=$hash"
$remoteTmp = "/tmp/madplanet-$version-$short.html"
$remoteTarget = '/webserver/madPlanet/index.html'
$remoteProbe = "/webserver/madPlanet/_deploy_${version}_$short.html"
Write-Host '[madPlanet] 1/3 Upload...'
& scp -o BatchMode=yes $src "${SshHost}:$remoteTmp"
if($LASTEXITCODE -ne 0) { throw "scp failed with exit code $LASTEXITCODE" }
Write-Host '[madPlanet] 2/3 Install root and unique probe copy...'
$cmd = "cat $remoteTmp | pct exec 105 -- tee $remoteTarget $remoteProbe > /dev/null && pct exec 105 -- chown www-data:www-data $remoteTarget $remoteProbe && rm -f $remoteTmp"
& ssh -o BatchMode=yes $SshHost $cmd
if($LASTEXITCODE -ne 0) { throw "remote replace failed with exit code $LASTEXITCODE" }
Write-Host '[madPlanet] 3/3 Verify byte hashes inside CT 105...'
$rootLine = & ssh -o BatchMode=yes $SshHost "pct exec 105 -- sha256sum $remoteTarget"
if($LASTEXITCODE -ne 0) { throw 'remote root hash command failed' }
$probeLine = & ssh -o BatchMode=yes $SshHost "pct exec 105 -- sha256sum $remoteProbe"
if($LASTEXITCODE -ne 0) { throw 'remote probe hash command failed' }
$rootHash = (($rootLine -split '\s+')[0]).Trim().ToLowerInvariant()
$probeHash = (($probeLine -split '\s+')[0]).Trim().ToLowerInvariant()
if($rootHash -ne $hash) { throw "ROOT HASH MISMATCH local=$hash remote=$rootHash" }
if($probeHash -ne $hash) { throw "PROBE HASH MISMATCH local=$hash remote=$probeHash" }
Write-Host '[madPlanet] DEPLOY OK.'
Write-Host "[madPlanet] Root:  https://planet.madmentat.ru/?v=$version-$short"
Write-Host "[madPlanet] Probe: https://planet.madmentat.ru/_deploy_${version}_$short.html"
