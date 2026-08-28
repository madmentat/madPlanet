const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const buildPs = fs.readFileSync(path.join(root, 'build.ps1'), 'utf8');
const madlibPs = fs.readFileSync(path.join(root, 'madlib.ps1'), 'utf8');
const glInit = fs.readFileSync(path.join(root, 'js/gl-init.js'), 'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION.txt'), 'utf8');

/* Every PowerShell source stays ASCII-only for Windows PowerShell 5.1. The
   Unicode sentinel helper moved from deploy.ps1 into the shared madlib.ps1
   when the two deployment roads were unified. */
for(const name of fs.readdirSync(root).filter(n => n.endsWith('.ps1'))){
  const bytes = fs.readFileSync(path.join(root, name));
  assert.ok([...bytes].every(b => b < 0x80), `${name} must be ASCII-only for Windows PowerShell 5.1`);
}
assert.match(madlibPs, /From-CodePoints/, 'madlib.ps1 must construct Unicode sentinels without literal non-ASCII text');

assert.equal((html.match(/<script(?:\s|>)/gi) || []).length, 1, 'index.html must contain exactly one opening <script>');
assert.equal((html.match(/<\/script>/gi) || []).length, 1, 'index.html must contain exactly one closing </script>');
assert.match(html, /<meta\s+charset=["']?utf-8/i, 'UTF-8 meta tag missing');
assert.match(html, /<!doctype html>/i, 'doctype missing');
assert.match(html, /<\/html>\s*$/i, 'closing html tag missing');
assert.ok(!html.includes('\uFFFD'), 'Unicode replacement character found');
assert.match(html, /Случайный/, 'Russian UTF-8 sentinel missing');
assert.match(html, /Скриншот/, 'Russian UTF-8 sentinel missing');
assert.match(buildPs, /AppendLine\('<\/script>'\)/, 'PowerShell builder must explicitly append closing script tag');
assert.match(buildPs, /UTF8Encoding\(\$false, \$true\)/, 'strict UTF-8 read expected in build.ps1');
assert.match(glInit, /Полный шейдер отклонён GPU, работает совместимый рендер/, 'Chromium/ANGLE compatibility renderer missing');
assert.match(glInit, /Совместимый рендер Chromium\/ANGLE/, 'compatibility renderer must be visibly labelled when the full shader fails');
assert.match(glInit, /id = 'shaderStatus'/, 'shader status badge element expected');
assert.match(html, /const\s+COMPAT_FRAG\s*=/, 'compatibility fragment shader must be embedded');
assert.match(html, /const\s+AURORA_FRAG\s*=/, 'separate aurora fragment shader must be embedded');
assert.match(version, /^VERSION\s+\d+\.\d+\.\d+\s*$/m, 'VERSION.txt must use X.Y.Z');
const currentVersion = (version.match(/^VERSION\s+(\d+\.\d+\.\d+)\s*$/m) || [])[1];
assert.ok(currentVersion, 'current version must be readable');
assert.match(html, new RegExp("const APP_VERSION = '" + currentVersion.replace(/\./g,'\\.') + "';"), 'build version stamp must match VERSION.txt');
assert.match(html, new RegExp('<div class=\"ver\">v' + currentVersion.replace(/\./g,'\\.') + '<\/div>'), 'visible UI version must match VERSION.txt');

/* Application shell must remain self-contained. */
assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), 'Google Fonts must not be referenced');
const externalRefs = html.match(/(?:href|src)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
assert.deepEqual(externalRefs, [], 'index.html must not reference external resources: ' + externalRefs.join(', '));

console.log('build-integrity.test.js: OK');
