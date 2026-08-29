# Build single index.html from modular source files.
# Windows PowerShell 5.1 compatible; ASCII-only source; UTF-8 output without BOM.
param([string]$Out = "$PSScriptRoot\index.html")
$ErrorActionPreference = 'Stop'
$DIR = $PSScriptRoot
function Read-Utf8Strict([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $enc = New-Object System.Text.UTF8Encoding($false, $true)
  return $enc.GetString($bytes)
}
$verText = Read-Utf8Strict (Join-Path $DIR 'VERSION.txt')
$m = [regex]::Match($verText, '(?m)^VERSION\s+(\d+\.\d+\.\d+)\s*$')
if(-not $m.Success) { throw 'VERSION.txt must contain VERSION X.Y.Z' }
$version = $m.Groups[1].Value
Write-Host "[madPlanet] Rebuilding version $version..."
$VERT = @'
#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
'@
$fragFiles = @('shaders/header.glsl','shaders/noise.glsl','shaders/terrain.glsl','shaders/weather-cloud-prelude.glsl','shaders/clouds.glsl','shaders/weather-cloud-visual.glsl','shaders/atmosphere.glsl','shaders/rings.glsl','shaders/fog.glsl','shaders/lightning.glsl','shaders/surface.glsl','shaders/sphere.glsl','shaders/main.glsl')
# An empty source module concatenates in silence: the program still links,
# const FRAG is still there, every existing check passes - and the planet
# comes out with no clouds and no surface at all. That is exactly how a
# 0-byte clouds.glsl and surface.glsl reached develop and built
# with "Build OK". The smallest real module is sphere.glsl at 237 bytes.
function Assert-NotEmpty([string]$Path, [string]$Text) {
  if($Text.Trim().Length -lt 120) {
    throw "source module looks empty or truncated: $Path ($($Text.Length) bytes)"
  }
}
$parts = New-Object System.Collections.Generic.List[string]
$parts.Add('#version 300 es')
foreach($rel in $fragFiles){
  $text = Read-Utf8Strict (Join-Path $DIR $rel)
  Assert-NotEmpty $rel $text
  $parts.Add($text)
}
$FRAG = $parts -join "`n"
foreach($rel in @('shaders/compat.glsl','shaders/aurora-pass.glsl','shaders/sky-pass.glsl')){
  Assert-NotEmpty $rel (Read-Utf8Strict (Join-Path $DIR $rel))
}
$COMPAT = "#version 300 es`n" + (Read-Utf8Strict (Join-Path $DIR 'shaders/compat.glsl'))
$AURORA = "#version 300 es`n" + (Read-Utf8Strict (Join-Path $DIR 'shaders/aurora-pass.glsl'))
$SKY = "#version 300 es`n" + (Read-Utf8Strict (Join-Path $DIR 'shaders/sky-pass.glsl'))
$shell = Read-Utf8Strict (Join-Path $DIR 'index.src.html')

# The version number lives in VERSION.txt and nowhere else. It used to be
# duplicated in index.src.html as well, and bumping only one of the two took
# about a minute: the build reported OK and the deploy then died on
# "stale build: visible version is not X.Y.Z", pointing at the validator
# rather than at the file that was actually out of date.
if($shell -notmatch '<div class="ver">[^<]*</div>') { throw 'index.src.html has no version div to fill in' }
$shell = [regex]::Replace($shell, '<div class="ver">[^<]*</div>', ('<div class="ver">v' + $version + '</div>'))
$jsFiles = @('js/gl-init.js','js/math.js','js/hydrology.js','js/state.js','js/procedural-synoptic-retirement.js','js/camera.js','js/magnetosphere.js','js/touch-ux.js','js/ui.js','js/ui-toggle-layout.js','js/planet-physics.js','js/star-orbit.js','js/param-model.js','js/screenshot.js','js/atmosphere-inventory.js','js/volcanic-atmosphere-coupling.js','js/water-budget.js','js/climate-regimes.js','js/stellar-weather-coupling.js','js/habitable-random.js','js/weather-core.js','js/orographic-lift.js','js/local-energy-balance.js','js/baric-field.js','js/wind-dynamics.js','js/h2o-advection.js','js/condensation.js','js/precipitation.js','js/soil-hydrology.js','js/weather-fronts.js','js/pressure-systems.js','js/deep-convection.js','js/vertical-stability.js','js/deep-convection-coupling.js','js/cloud-radiative-feedback.js','js/physical-fog.js','js/lightning-weather.js','js/cloud-visual-response.js','js/weather-cloud-gpu.js','js/fog-gpu.js','js/planet-export.js','js/planet-share-activation.js','js/render.js','js/weather-cloud-render.js','js/fog-render.js','js/screenshot-trigger.js')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine($shell.TrimEnd())
[void]$sb.AppendLine()
[void]$sb.AppendLine("const APP_VERSION = '$version';")
[void]$sb.AppendLine('const VERT = `'+$VERT+'`;')
[void]$sb.AppendLine('const FRAG = `'+$FRAG+'`;')
[void]$sb.AppendLine('const COMPAT_FRAG = `'+$COMPAT+'`;')
[void]$sb.AppendLine('const AURORA_FRAG = `'+$AURORA+'`;')
[void]$sb.AppendLine('const SKY_FRAG = `'+$SKY+'`;')
foreach($rel in $jsFiles){
  $text = Read-Utf8Strict (Join-Path $DIR $rel)
  Assert-NotEmpty $rel $text
  [void]$sb.AppendLine($text.TrimEnd()); [void]$sb.AppendLine()
}
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('</body>')
[void]$sb.AppendLine('</html>')
$text=$sb.ToString()
$open=([regex]::Matches($text,'(?i)<script(?:\s|>)')).Count
$close=([regex]::Matches($text,'(?i)</script>')).Count
if($open -ne 1 -or $close -ne 1){ throw "build integrity: script tags $open/$close" }
if(-not $text.Contains("const APP_VERSION = '$version';")){ throw 'build integrity: version stamp missing' }
if($text.IndexOf([char]0xFFFD) -ge 0){ throw 'build integrity: invalid UTF-8 marker' }
$enc=New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Out,$text,$enc)
$strict=Read-Utf8Strict $Out
if($strict -ne $text){ throw 'build integrity: UTF-8 round-trip mismatch' }
$hash=(Get-FileHash $Out -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "[madPlanet] Build OK: version=$version bytes=$((Get-Item $Out).Length) SHA256=$hash"