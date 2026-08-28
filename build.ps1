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
$fragFiles = @('shaders/header.glsl','shaders/noise.glsl','shaders/terrain.glsl','shaders/clouds.glsl','shaders/atmosphere.glsl','shaders/rings.glsl','shaders/fog.glsl','shaders/lightning.glsl','shaders/surface.glsl','shaders/stars.glsl','shaders/sphere.glsl','shaders/main.glsl')
$parts = New-Object System.Collections.Generic.List[string]
$parts.Add('#version 300 es')
foreach($rel in $fragFiles){ $parts.Add((Read-Utf8Strict (Join-Path $DIR $rel))) }
$FRAG = $parts -join "`n"
$COMPAT = "#version 300 es`n" + (Read-Utf8Strict (Join-Path $DIR 'shaders/compat.glsl'))
$AURORA = "#version 300 es`n" + (Read-Utf8Strict (Join-Path $DIR 'shaders/aurora-pass.glsl'))
$shell = Read-Utf8Strict (Join-Path $DIR 'index.src.html')
$jsFiles = @('js/gl-init.js','js/math.js','js/hydrology.js','js/state.js','js/camera.js','js/magnetosphere.js','js/ui.js','js/screenshot.js','js/render.js')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine($shell.TrimEnd())
[void]$sb.AppendLine()
[void]$sb.AppendLine("const APP_VERSION = '$version';")
[void]$sb.AppendLine('const VERT = `'+$VERT+'`;')
[void]$sb.AppendLine('const FRAG = `'+$FRAG+'`;')
[void]$sb.AppendLine('const COMPAT_FRAG = `'+$COMPAT+'`;')
[void]$sb.AppendLine('const AURORA_FRAG = `'+$AURORA+'`;')
foreach($rel in $jsFiles){ [void]$sb.AppendLine((Read-Utf8Strict (Join-Path $DIR $rel)).TrimEnd()); [void]$sb.AppendLine() }
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
