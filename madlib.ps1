# madPlanet shared helpers: version, build validation, server upload.
# Windows PowerShell 5.1 compatible. ASCII-only source.
#
# Dot-source from a script that sits next to it:
#   . (Join-Path $PSScriptRoot 'madlib.ps1')
#
# The reason this file exists: there are now two roads to the server, one from
# the working directory and one from GitHub. They must agree on what counts as
# a valid build. With the checks living inside deploy.ps1 only, the second road
# would have been free to publish something the first road would have refused.

function Require-Command([string]$Name) {
  if(-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command not found: $Name" }
}

# Builds a string from code points so this file itself stays ASCII.
function From-CodePoints([int[]]$CodePoints) {
  $sb = New-Object System.Text.StringBuilder
  foreach($cp in $CodePoints) { [void]$sb.Append([char]$cp) }
  return $sb.ToString()
}

# git marks objects read-only, and a plain Remove-Item then fails on Windows.
function Remove-TreeForce([string]$Path) {
  if(-not (Test-Path -LiteralPath $Path)) { return }
  Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
    ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
}

# Runs git with native stderr demoted to ordinary console output, and returns
# its stdout. PowerShell 5.1 turns any native stderr into a terminating error
# while $ErrorActionPreference is 'Stop', and git writes perfectly ordinary
# notices there: the "CRLF will be replaced by LF" warning alone was enough to
# abort a push. The exit code decides success, not whether git said something.
function Invoke-Git([string[]]$GitArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & git @GitArgs
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if($code -ne 0) { throw ('git ' + ($GitArgs -join ' ') + " failed with exit code $code") }
  return (($out | ForEach-Object { "$_" }) -join "`n").Trim()
}

# Same, but hands back the exit code instead of throwing. For the calls where
# a non-zero code is the answer rather than a failure: git diff --cached
# --quiet exits 1 precisely when something is staged.
function Get-GitExitCode([string[]]$GitArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & git @GitArgs | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return $code
}

# Reads VERSION.txt from a project root and returns "X.Y.Z".
function Get-MadVersion([string]$Root) {
  $verFile = Join-Path $Root 'VERSION.txt'
  if(-not (Test-Path -LiteralPath $verFile)) { throw "VERSION.txt not found in $Root" }
  $verText = [System.IO.File]::ReadAllText($verFile, [System.Text.Encoding]::UTF8)
  $m = [regex]::Match($verText, '(?m)^VERSION\s+(\d+\.\d+\.\d+)\s*$')
  if(-not $m.Success) { throw 'VERSION.txt must contain VERSION X.Y.Z' }
  return $m.Groups[1].Value
}

# Validates a built index.html and returns its lowercase SHA256.
function Test-MadBuild([string]$Path, [string]$Version) {
  if(-not (Test-Path -LiteralPath $Path)) { throw "built file not found: $Path" }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  try { $html = $utf8.GetString($bytes) } catch { throw 'build is not valid UTF-8' }
  $lower = $html.ToLowerInvariant()
  if(-not $lower.Contains('<meta charset="utf-8">')) { throw 'build has no UTF-8 meta charset' }
  $openScripts = ([regex]::Matches($html, '(?i)<script(?:\s|>)')).Count
  $closeScripts = ([regex]::Matches($html, '(?i)</script>')).Count
  if($openScripts -ne 1 -or $closeScripts -ne 1) { throw "script tag mismatch: open=$openScripts close=$closeScripts" }
  if($html -notmatch 'const\s+FRAG\s*=' -or $html -notmatch 'const\s+COMPAT_FRAG\s*=' -or $html -notmatch 'const\s+AURORA_FRAG\s*=') { throw 'embedded shaders missing' }
  $versionStamp = "const APP_VERSION = '$Version';"
  if(-not $html.Contains($versionStamp)) { throw "stale build: APP_VERSION is not $Version" }
  if(-not $html.Contains("<div class=`"ver`">v$Version</div>")) { throw "stale build: visible version is not $Version" }
  if($html.IndexOf([char]0xFFFD) -ge 0) { throw 'Unicode replacement character found in build' }
  # Cyrillic sentinels catch an encoding accident that survives every ASCII
  # check above: the file would still be valid UTF-8, just full of garbage.
  $sentinelRandom = From-CodePoints @(0x421,0x43B,0x443,0x447,0x430,0x439,0x43D,0x44B,0x439)
  $sentinelShot = From-CodePoints @(0x421,0x43A,0x440,0x438,0x43D,0x448,0x43E,0x442)
  if(-not $html.Contains($sentinelRandom) -or -not $html.Contains($sentinelShot)) { throw 'UTF-8 sentinel text missing or corrupted' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Uploads a validated file, installs it inside CT 105 and verifies byte hashes
# on the server. The probe copy carries the hash in its name, so it is always
# possible to tell which build a browser actually received.
function Publish-MadFile([string]$Path, [string]$Version, [string]$Hash, [string]$SshHost) {
  Require-Command 'scp'
  Require-Command 'ssh'
  $short = $Hash.Substring(0,16)
  $remoteTmp = "/tmp/madplanet-$Version-$short.html"
  $remoteTarget = '/webserver/madPlanet/index.html'
  $remoteProbe = "/webserver/madPlanet/_deploy_${Version}_$short.html"
  # scp and ssh talk on stderr for their own reasons - a banner, a host key
  # notice - and under 'Stop' that would abort a deploy that is going fine.
  # Same trap as with git; the exit codes below are the real check.
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Write-Host '[madPlanet] 1/3 Upload...'
    & scp -o BatchMode=yes $Path "${SshHost}:$remoteTmp"
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
  } finally {
    $ErrorActionPreference = $old
  }
  $rootHash = (($rootLine -split '\s+')[0]).Trim().ToLowerInvariant()
  $probeHash = (($probeLine -split '\s+')[0]).Trim().ToLowerInvariant()
  if($rootHash -ne $Hash) { throw "ROOT HASH MISMATCH local=$Hash remote=$rootHash" }
  if($probeHash -ne $Hash) { throw "PROBE HASH MISMATCH local=$Hash remote=$probeHash" }
  Write-Host '[madPlanet] DEPLOY OK.'
  Write-Host "[madPlanet] Root:  https://planet.madmentat.ru/?v=$Version-$short"
  Write-Host "[madPlanet] Probe: https://planet.madmentat.ru/_deploy_${Version}_$short.html"
}
