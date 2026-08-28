# Push the current working tree to GitHub. Half of the pair; the other half is
# deploy-from-github.ps1, which takes the branch back down and publishes it.
# Windows PowerShell 5.1 compatible. ASCII-only source.
#
#   .\push.ps1                          -- build, commit, push to develop
#   .\push.ps1 -Message "text"          -- with your own commit message
#   .\push.ps1 -Branch snapshot/0.5.30  -- to another branch
#   .\push.ps1 -NoBuild                 -- push without rebuilding index.html
#
# If .ps1 files will not start at all, use push.cmd instead: it asks for an
# execution policy exemption for its own process only.
#
# index.html is rebuilt before committing. deploy-from-github.ps1 rebuilds
# anyway, so the server does not depend on it, but a committed index.html that
# disagrees with the sources lying next to it is a trap for whoever reads the
# repository next.
[CmdletBinding()]
param(
  [string]$Message,
  [string]$Branch = 'develop',
  [string]$Remote = 'origin',
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'madlib.ps1')
Require-Command 'git'

$root = $PSScriptRoot
if((Invoke-Git @('-C', $root, 'rev-parse', '--is-inside-work-tree')) -ne 'true') {
  throw "not a git work tree: $root"
}

$version = Get-MadVersion $root
Write-Host "[madPlanet] version $version"

if($NoBuild) {
  Write-Host '[madPlanet] NoBuild requested: validating existing index.html.'
} else {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'build.ps1')
  if($LASTEXITCODE -ne 0) { throw "build.ps1 failed with exit code $LASTEXITCODE" }
}

# Nothing broken goes onto the branch: the same validation the server gets.
$hash = Test-MadBuild (Join-Path $root 'index.html') $version
Write-Host "[madPlanet] validation OK: version=$version SHA256=$hash"

$current = Invoke-Git @('-C', $root, 'rev-parse', '--abbrev-ref', 'HEAD')
if($current -ne $Branch) {
  Write-Host "[madPlanet] switching from $current to $Branch..."
  try { [void](Invoke-Git @('-C', $root, 'checkout', $Branch)) }
  catch { throw "cannot switch to $Branch; commit or stash your changes first" }
}

# If the branch moved on GitHub while you were working, find that out here
# and not from a rejected push. Nothing is merged automatically - which of two
# histories is right is not a decision a script gets to make.
[void](Invoke-Git @('-C', $root, 'fetch', $Remote, $Branch))
$behind = Invoke-Git @('-C', $root, 'rev-list', '--count', "HEAD..$Remote/$Branch")
if($behind -ne '0') {
  throw "$Remote/$Branch is $behind commit(s) ahead of your HEAD; run: git pull --rebase $Remote $Branch"
}

[void](Invoke-Git @('-C', $root, 'add', '-A'))

# git diff --cached --quiet exits 1 when something is staged. That is the
# answer, not a failure.
if((Get-GitExitCode @('-C', $root, 'diff', '--cached', '--quiet')) -ne 0) {
  if([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "madPlanet $version (" + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ")"
  }
  Write-Host (Invoke-Git @('-C', $root, 'commit', '-m', $Message))
} else {
  Write-Host '[madPlanet] nothing to commit; pushing whatever is not pushed yet.'
}

[void](Invoke-Git @('-C', $root, 'push', $Remote, $Branch))

$head = Invoke-Git @('-C', $root, 'rev-parse', '--short', 'HEAD')
$subject = Invoke-Git @('-C', $root, 'log', '-1', '--pretty=%s')
$url = (Invoke-Git @('-C', $root, 'remote', 'get-url', $Remote)) -replace '\.git$', ''
Write-Host '[madPlanet] PUSH OK.'
Write-Host "[madPlanet] $Branch -> $head  $subject"
Write-Host "[madPlanet] $url/tree/$Branch"
