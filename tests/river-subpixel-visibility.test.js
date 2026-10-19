'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const shader=fs.readFileSync(path.join(__dirname,'../shaders/river-channels.glsl'),'utf8');
const surface=fs.readFileSync(path.join(__dirname,'../shaders/surface.glsl'),'utf8');
const cpu=fs.readFileSync(path.join(__dirname,'../js/river-drainage.js'),'utf8');
assert.match(shader,/return vec2\(texture\(uRiverLoopTex,normalize\(d\)\)\.r,0\.0\)/,
 'visibility must come directly from painted geographic coverage');
assert.doesNotMatch(shader,/footprint\s*\*|physicalHalfWidth|uvec4|for\s*\(int/,
 'the view must not change river width or reconstruct edges in the fragment shader');
assert.match(cpu,/function riverDrainageDrawDab\(/);
assert.match(cpu,/const radius=M\*\(0\.00070\+0\.0060\*Math\.pow\(w,2\.2\)\)/,
 'brush width is determined by river discharge and atlas scale, never camera distance');
assert.doesNotMatch(surface,/float floodplain=drainage\.y/);
assert.match(surface,/float dryChannel = riverGeom\*land\*\(1\.0-hotLiquidGate\)/,
 'at high temperature the same river geography should turn to sediment');
console.log('river-subpixel-visibility.test.js: OK (static geographic river-mask and dry-bed regression)');
