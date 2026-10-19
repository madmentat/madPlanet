#!/usr/bin/env bash
# Compile the production river body against its real integer sampler type,
# without relying on full shader compilation as an ordinary text-only test.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v glslangValidator >/dev/null || { echo 'glslangValidator is required' >&2; exit 1; }
shader="$(mktemp --suffix=.frag)"
trap 'rm -f "$shader"' EXIT
{
  printf '#version 300 es\nprecision highp float;\nprecision highp int;\n'
  printf 'uniform highp usamplerCube uRiverLoopTex;\n'
  printf 'uniform float uRiverLoopOn;\n'
  printf 'out vec4 fragColor;\n'
  cat shaders/river-channels.glsl
  printf '\nvoid main(){vec3 d=normalize(vec3(1.0,0.3,0.15));'
  printf 'vec2 channel=riverChannelSample(d,0.001);fragColor=vec4(channel,0.0,1.0);}\n'
} > "$shader"
glslangValidator -S frag "$shader"
echo 'river-glsl-syntax: OK'
