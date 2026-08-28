# madPlanet safe deploy from the working directory.
# Windows PowerShell 5.1 compatible. ASCII-only source.
# Default: rebuild to a temporary file, validate it, then deploy.
# Optional emergency mode: .\deploy.ps1 -NoBuild
#
# This road publishes what is on the desk right now, experiments included.
# To publish what the team can actually see, use .\deploy-from-github.ps1.
[CmdletBinding()]
param(
  [string]$SshHost = 'mimo-update',
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'madlib.ps1')

$srcDir = $PSScriptRoot
$indexPath = Join-Path $srcDir 'index.html'
$tmpBuild = Join-Path $srcDir 'index.deploy-build.tmp.html'

$version = Get-MadVersion $srcDir
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

$hash = Test-MadBuild $src $version

# The freshly built file replaces index.html only after it has passed every
# check: a failed build must never leave a broken index.html behind.
if(-not $NoBuild) {
  [System.IO.File]::WriteAllBytes($indexPath, [System.IO.File]::ReadAllBytes($src))
  Remove-Item -LiteralPath $tmpBuild -Force -ErrorAction SilentlyContinue
  $src = $indexPath
}

$sizeKB = [math]::Round((Get-Item -LiteralPath $src).Length / 1KB)
Write-Host "[madPlanet] validation OK: version=$version UTF-8 script=1/1 ${sizeKB}KB SHA256=$hash"
Publish-MadFile $src $version $hash $SshHost
