// Tests for the extension updater's logic (vscode-extension/lib/updater.js). Run: node tests/updater.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const U = require('../vscode-extension/lib/updater');

const SHA = 'a'.repeat(64);
const asset = (name, host) => ({ name, browser_download_url: 'https://' + (host || 'github.com') + '/GIAMAT13/agent-dashboard/releases/download/v0.4.0/' + name });
const release = (tag, names, host) => ({ tag_name: tag, assets: names.map((n) => asset(n, host)) });

// Release names and versions
assert.strictEqual(U.releaseVersion({ tag_name: 'v0.4.0' }), '0.4.0');
assert.strictEqual(U.releaseVersion({ tag_name: 'release-x' }), null);
assert.strictEqual(U.releaseVersion(null), null);
console.log('ok - the version comes from the release tag');

// Only the GitHub hosts over https
assert.strictEqual(U.allowedUrl('https://github.com/a/b'), true);
assert.strictEqual(U.allowedUrl('https://objects.githubusercontent.com/x/y.vsix'), true);
assert.strictEqual(U.allowedUrl('https://api.github.com/repos/a/b/releases/latest'), true);
assert.strictEqual(U.allowedUrl('http://github.com/a/b'), false, 'no plain http');
assert.strictEqual(U.allowedUrl('https://github.com.evil.test/a'), false, 'the host must match exactly');
assert.strictEqual(U.allowedUrl('https://evil.test/github.com/a'), false);
assert.strictEqual(U.allowedUrl('not a url'), false);
console.log('ok - only https links to GitHub hosts are used');

// The hash file
assert.strictEqual(U.parseSha256(SHA + '  agent-dashboard-0.4.0.vsix\n'), SHA);
assert.strictEqual(U.parseSha256(SHA.toUpperCase()), SHA, 'the hash is read in lower case');
assert.strictEqual(U.parseSha256('no hash here'), null);
assert.strictEqual(U.parseSha256(''), null);
console.log('ok - the hash is read from the .sha256 file');

// Assets by name
const good = release('v0.4.0', ['agent-dashboard-0.4.0.vsix', 'agent-dashboard-0.4.0.vsix.sha256', 'other.zip']);
assert.strictEqual(U.pickAssets(good, '0.4.0').vsix.name, 'agent-dashboard-0.4.0.vsix');
assert.strictEqual(U.pickAssets(good, '0.4.0').sha256.name, 'agent-dashboard-0.4.0.vsix.sha256');
assert.strictEqual(U.pickAssets(good, '0.5.0'), null, 'the file name must have the same version');
assert.strictEqual(U.pickAssets(release('v0.4.0', ['agent-dashboard-0.4.0.vsix']), '0.4.0'), null, 'the hash file is needed too');
console.log('ok - the .vsix and its hash are found by version');

// The plan
assert.deepStrictEqual(U.plan(good, '0.4.0'), { action: 'none', version: '0.4.0' }, 'the same version: nothing to do');
assert.deepStrictEqual(U.plan(good, '0.5.0'), { action: 'none', version: '0.4.0' }, 'an older release: nothing to do');
const p = U.plan(good, '0.3.31');
assert.strictEqual(p.action, 'install');
assert.strictEqual(p.version, '0.4.0');
assert.strictEqual(p.vsix, 'https://github.com/GIAMAT13/agent-dashboard/releases/download/v0.4.0/agent-dashboard-0.4.0.vsix');
assert.strictEqual(p.sha256, 'https://github.com/GIAMAT13/agent-dashboard/releases/download/v0.4.0/agent-dashboard-0.4.0.vsix.sha256');
assert.deepStrictEqual(U.plan(release('v0.4.0', ['x.zip']), '0.3.31'), { action: 'none', version: '0.4.0', reason: 'no-assets' });
assert.deepStrictEqual(U.plan(release('v0.4.0', ['agent-dashboard-0.4.0.vsix', 'agent-dashboard-0.4.0.vsix.sha256'], 'evil.test'), '0.3.31'),
  { action: 'none', version: '0.4.0', reason: 'bad-url' });
assert.deepStrictEqual(U.plan({ tag_name: 'nope' }, '0.3.31'), { action: 'none', version: null });
console.log('ok - a newer release with both files is planned; anything else does nothing, with a reason');

// The checksum of a file
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-upd-'));
  try {
    const file = path.join(dir, 'x.vsix');
    fs.writeFileSync(file, 'hello vsix');
    const want = crypto.createHash('sha256').update('hello vsix').digest('hex');
    assert.strictEqual(await U.fileSha256(file), want);
    console.log('ok - the checksum of a downloaded file is computed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('all updater tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
