// Tests for the plugin auto-update (claude-plugin/scripts/lib/plugin-update.js).
// Nothing real is touched: "claude" is a fake command in a temp folder, put first on PATH.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptsDir = path.join(__dirname, '..', 'claude-plugin', 'scripts');
const script = path.join(scriptsDir, 'lib', 'plugin-update.js');
const Settings = require(path.join(scriptsDir, 'lib', 'settings'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-update-test-'));
process.env.AGENT_DASH_HOME = tmp;
delete process.env.AGENT_DASH_PLUGIN_UPDATE;
const PU = require(script);

const T = 1700000000000; // a fixed "now", in ms

function resetState() {
  try { fs.unlinkSync(PU.stateFile()); } catch { /* no state yet */ }
}

function counter() {
  const c = { count: 0 };
  c.start = () => { c.count++; };
  return c;
}

// The text of "claude plugin list": two plugins, one of them not loading (as on a real machine)
function listText(version) {
  return [
    'Installed plugins:', '',
    '  ❯ agent-dashboard@agent-dashboard',
    '    Version: ' + version,
    '    Scope: user',
    '    Status: ✔ enabled', '',
    '  ❯ bg-runner@bg-local',
    '    Version: 1.0.6',
    '    Scope: user',
    '    Status: ✘ failed to load',
    '    Error: Plugin bg-runner not found in marketplace bg-local', '',
  ].join('\r\n');
}

// 1. The version of the installed plugin, from the plugin list
assert.strictEqual(PU.versionFrom(listText('0.3.31')), '0.3.31');
assert.strictEqual(PU.versionFrom(listText('0.4.0').replace(/\r\n/g, '\n')), '0.4.0');
assert.strictEqual(PU.versionFrom('  ❯ bg-runner@bg-local\n    Version: 1.0.6\n'), null);
assert.strictEqual(PU.versionFrom('  ❯ agent-dashboard@agent-dashboard\n    Scope: user\n'), null);
assert.strictEqual(PU.versionFrom(''), null);
assert.strictEqual(PU.versionFrom(undefined), null);
console.log('ok - the version is read from the plugin list');

// 2. runUpdate: the marketplace, then the plugin, then the list again
function fakeClaude(versions, { updateStatus = 0 } = {}) {
  const calls = [];
  let current = versions[0];
  const run = (cmd) => {
    calls.push(cmd);
    if (cmd === 'claude plugin list') return { status: 0, out: listText(current) };
    if (cmd === 'claude plugin marketplace update agent-dashboard') return { status: 0, out: 'Marketplace updated' };
    if (cmd === 'claude plugin update agent-dashboard@agent-dashboard') {
      if (updateStatus === 0) current = versions[1];
      return { status: updateStatus, out: updateStatus ? 'update failed: no network' : 'Plugin updated' };
    }
    throw new Error('unexpected command: ' + cmd);
  };
  return { run, calls };
}

resetState();
const up = fakeClaude(['0.3.31', '0.4.0']);
const s1 = PU.runUpdate(up.run, T);
assert.deepStrictEqual(up.calls, [
  'claude plugin list',
  'claude plugin marketplace update agent-dashboard',
  'claude plugin update agent-dashboard@agent-dashboard',
  'claude plugin list',
]);
assert.strictEqual(s1.ok, true);
assert.strictEqual(s1.checkedAt, T);
assert.deepStrictEqual(s1.notice, { from: '0.3.31', to: '0.4.0', at: T });
assert.strictEqual(PU.readState().notice.to, '0.4.0');
console.log('ok - a new version leaves a notice');

resetState();
const same = PU.runUpdate(fakeClaude(['0.3.31', '0.3.31']).run, T);
assert.strictEqual(same.ok, true);
assert.strictEqual(same.notice, undefined);
console.log('ok - no notice when the version did not change');

resetState();
const failed = PU.runUpdate(fakeClaude(['0.3.31', '0.3.31'], { updateStatus: 1 }).run, T);
assert.strictEqual(failed.ok, false);
assert.match(failed.error, /update failed/);
assert.strictEqual(failed.notice, undefined);
console.log('ok - a failed update is recorded with no notice');

// 3. The SessionStart check: at most one a day, and a notice shown once
resetState();
const first = counter();
assert.strictEqual(PU.sessionStart({ now: T, start: first.start }), '');
assert.strictEqual(first.count, 1);
assert.strictEqual(PU.readState().checkedAt, T);

const sameDay = counter();
PU.sessionStart({ now: T + 60 * 1000, start: sameDay.start });
assert.strictEqual(sameDay.count, 0);

const nextDay = counter();
PU.sessionStart({ now: T + PU.DAY_MS, start: nextDay.start });
assert.strictEqual(nextDay.count, 1);
console.log('ok - the check starts at most once a day');

resetState();
fs.mkdirSync(path.dirname(PU.stateFile()), { recursive: true });
fs.writeFileSync(PU.stateFile(), JSON.stringify({ checkedAt: T, notice: { from: '0.3.31', to: '0.4.0', at: T } }));
const quiet = counter();
const notice = PU.sessionStart({ now: T + 1000, start: quiet.start });
assert.match(notice, /updated from 0\.3\.31 to 0\.4\.0/);
assert.strictEqual(PU.sessionStart({ now: T + 2000, start: quiet.start }), '');
assert.strictEqual(quiet.count, 0);
assert.strictEqual(PU.readState().notice, null);
console.log('ok - the notice is shown once');

// 4. The switch off, and the background run itself starts no further check
resetState();
fs.mkdirSync(path.dirname(Settings.file()), { recursive: true });
fs.writeFileSync(Settings.file(), JSON.stringify({ pluginAutoUpdate: false }));
const off = counter();
assert.strictEqual(PU.sessionStart({ now: T, start: off.start }), '');
assert.strictEqual(off.count, 0);
fs.unlinkSync(Settings.file());

process.env.AGENT_DASH_PLUGIN_UPDATE = '1';
const inner = counter();
assert.strictEqual(PU.sessionStart({ now: T, start: inner.start }), '');
assert.strictEqual(inner.count, 0);
delete process.env.AGENT_DASH_PLUGIN_UPDATE;
console.log('ok - the switch off and the background run start no check');

// 5. The background run as a real child process, with a fake "claude" first on PATH
function fakeClaudeMain() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, 'version.txt');
  const args = process.argv.slice(2).join(' ');
  if (args === 'plugin list') {
    const v = fs.readFileSync(file, 'utf8').trim();
    process.stdout.write('Installed plugins:\n\n  ❯ agent-dashboard@agent-dashboard\n    Version: ' + v + '\n    Scope: user\n    Status: ✔ enabled\n');
  } else if (args.startsWith('plugin marketplace update ')) {
    process.stdout.write('Marketplace updated\n');
  } else if (args === 'plugin update agent-dashboard@agent-dashboard') {
    fs.writeFileSync(file, process.env.FAKE_NEXT);
    process.stdout.write('Plugin updated\n');
  } else {
    process.stdout.write('unknown: ' + args + '\n');
    process.exit(2);
  }
}

const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'fake-claude.js'), '(' + fakeClaudeMain.toString() + ')();\n');
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n"' + process.execPath + '" "%~dp0fake-claude.js" %*\r\n');
} else {
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexec "' + process.execPath + '" "$(dirname "$0")/fake-claude.js" "$@"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
}
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
const oldPath = process.env[pathKey];
process.env[pathKey] = bin + path.delimiter + (oldPath || '');
process.env.FAKE_NEXT = '0.4.0';

resetState();
fs.writeFileSync(path.join(bin, 'version.txt'), '0.3.31');
const r = spawnSync(process.execPath, [script, '--run'], { stdio: 'ignore', windowsHide: true, timeout: 60000 });
assert.strictEqual(r.status, 0);
let st = PU.readState();
assert.strictEqual(st.ok, true);
assert.deepStrictEqual([st.before, st.after], ['0.3.31', '0.4.0']);
assert.deepStrictEqual([st.notice.from, st.notice.to], ['0.3.31', '0.4.0']);
console.log('ok - the background run updates the plugin through claude and keeps the notice');

// The detached start (what the hook does) finishes on its own
resetState();
fs.writeFileSync(path.join(bin, 'version.txt'), '0.3.31');
PU.startBackground();
const until = Date.now() + 30000;
while (!PU.readState().notice && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
st = PU.readState();
assert.ok(st.notice, 'the detached run wrote its result');
console.log('ok - the detached background run finishes on its own');

if (oldPath === undefined) delete process.env[pathKey]; else process.env[pathKey] = oldPath;
delete process.env.FAKE_NEXT;
fs.rmSync(tmp, { recursive: true, force: true });
console.log('all plugin update tests passed');
