# Deploy what is on GitHub, not what is on the desk. The other half of the
# pair; push.ps1 is what puts a branch up there in the first place.
# Windows PowerShell 5.1 compatible. ASCII-only source.
#
#   .\deploy-from-github.ps1                          -- develop to the server
#   .\deploy-from-github.ps1 -Branch snapshot/0.5.30  -- roll back to a snapshot
#   .\deploy-from-github.ps1 -KeepClone               -- leave the clone to look at
#
# The branch is cloned into a temporary directory and built there. The working
# directory is neither read nor written, so a half-finished experiment lying on
# the desk cannot reach the server by accident, and what goes live is exactly
# what anyone else pulling that branch would get.
[CmdletBinding()]
param(
  [string]$Repo,
  [string]$Branch = 'develop',
  [string]$Remote = 'origin',
  [string]$SshHost = 'mimo-update',
  [switch]$KeepClone
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'madlib.ps1')
Require-Command 'git'

if([string]::IsNullOrWhiteSpace($Repo)) {
  try { $Repo = Invoke-Git @('-C', $PSScriptRoot, 'remote', 'get-url', $Remote) }
  catch { throw "cannot read remote '$Remote'; pass -Repo explicitly" }
  if([string]::IsNullOrWhiteSpace($Repo)) { throw "remote '$Remote' has no URL; pass -Repo explicitly" }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$work = Join-Path ([System.IO.Path]::GetTempPath()) "madplanet-deploy-$stamp"

Write-Host "[madPlanet] Cloning $Branch from $Repo..."
[void](Invoke-Git @('clone', '--depth', '1', '--branch', $Branch, '--quiet', $Repo, $work))

try {
  $head = Invoke-Git @('-C', $work, 'rev-parse', '--short', 'HEAD')
  $subject = Invoke-Git @('-C', $work, 'log', '-1', '--pretty=%s')
  Write-Host "[madPlanet] $Branch -> $head  $subject"

  $version = Get-MadVersion $work
  Write-Host "[madPlanet] version $version"

  $built = Join-Path $work 'index.deploy-build.tmp.html'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $work 'build.ps1') -Out $built
  if($LASTEXITCODE -ne 0) { throw "build.ps1 failed with exit code $LASTEXITCODE" }

  $hash = Test-MadBuild $built $version
  $sizeKB = [math]::Round((Get-Item -LiteralPath $built).Length / 1KB)
  Write-Host "[madPlanet] validation OK: version=$version UTF-8 script=1/1 ${sizeKB}KB SHA256=$hash"

  # The sources on the branch must reproduce the index.html committed beside
  # them. A mismatch means someone edited one without the other, and it is
  # worth saying so out loud - but the sources win, because they are what the
  # build is made of.
  $committed = Join-Path $work 'index.html'
  if(Test-Path -LiteralPath $committed) {
    $committedHash = (Get-FileHash -LiteralPath $committed -Algorithm SHA256).Hash.ToLowerInvariant()
    if($committedHash -ne $hash) {
      Write-Warning 'committed index.html does not match a fresh build of its own sources'
      Write-Warning "  committed $committedHash"
      Write-Warning "  rebuilt   $hash"
      Write-Warning 'Publishing the fresh build.'
    } else {
      Write-Host '[madPlanet] committed index.html reproduces byte for byte.'
    }
  }

  Publish-MadFile $built $version $hash $SshHost
} finally {
  if($KeepClone) {
    Write-Host "[madPlanet] clone kept at $work"
  } else {
    Remove-TreeForce $work
  }
}
