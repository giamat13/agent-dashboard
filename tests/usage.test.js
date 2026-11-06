// Tests for the Claude usage limits (claude-plugin/scripts/lib/usage.js) and the commands that show them (dash.js usage, ci-eta).
// Run: node tests/usage.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-usage-'));
// The login file is looked up in the home folder: point every home at an empty folder so nothing real is read.
process.env.AGENT_DASH_HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
const USAGE = require('../claude-plugin/scripts/lib/usage');
const S = require('../claude-plugin/scripts/lib/state');
const DASH = path.join(__dirname, '..', 'claude-plugin', 'scripts', 'dash.js');

// A fake reading: the test decides what the usage endpoint "says" and counts how often it is asked.
let reading = null;
let asked = 0;
USAGE.setFetchForTests(() => { asked++; return reading; });
const ok = (fiveHour, weekly) => ({ ok: true, fiveHour: { pct: fiveHour, resetsAt: null }, weekly: { pct: weekly, resetsAt: null }, opus: null });

try {
  // A reading younger than 20 seconds is reused.
  reading = ok(1, 1);
  let st = {};
  USAGE.current(st, 1000);
  const once = asked;
  USAGE.current(st, 5000);
  assert.strictEqual(asked, once, 'a reading younger than 20 seconds is reused');
  console.log('ok - a fresh reading is reused');

  // A failed read is not repeated for a minute; after the wait it is read again.
  asked = 0;
  reading = { ok: false, error: 'network' };
  st = {};
  assert.strictEqual(USAGE.current(st, 1000), null);
  assert.strictEqual(st.usageSnap.ok, false);
  assert.strictEqual(st.usageSnap.retryAt, 1000 + 60 * 1000);
  const before = asked;
  USAGE.current(st, 30000);
  assert.strictEqual(asked, before, 'while waiting: not asked');
  reading = ok(30, 30);
  assert.strictEqual(USAGE.current(st, 61001).weekly.pct, 30, 'after the wait: read again');
  console.log('ok - a failed read waits a minute before it is repeated');

  // Rate limited: the wait is ten minutes.
  reading = { ok: false, status: 429 };
  st = {};
  assert.strictEqual(USAGE.current(st, 1000), null);
  assert.strictEqual(st.usageSnap.error, 'http 429');
  assert.strictEqual(st.usageSnap.retryAt, 1000 + 10 * 60 * 1000);
  console.log('ok - a rate limit waits ten minutes');

  // No login file: the real child process reports it, and nothing is read.
  USAGE.setFetchForTests(null);
  st = {};
  assert.strictEqual(USAGE.current(st, 1000), null);
  assert.strictEqual(st.usageSnap.error, 'not-logged-in');
  console.log('ok - without a login nothing is read');

  // The command line shows the limits only, in the temp folder.
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: tmp, AGENT_DASH_HOME: tmp, USERPROFILE: tmp, HOME: tmp });
  const cli = (...args) => spawnSync(process.execPath, [DASH, ...args], { env, encoding: 'utf8', timeout: 30000 });
  let r = cli('usage', '--json');
  assert.strictEqual(r.status, 0, r.stderr);
  const info = JSON.parse(r.stdout);
  assert.strictEqual(info.error, 'not-logged-in');
  assert.strictEqual(info.weekly, null);
  assert.strictEqual(info.fiveHour, null);
  assert.ok(!('expected' in info) && !('task' in info), 'no planned figures');
  r = cli('usage');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/Weekly limit: \?/.test(r.stdout) && !/expected|Task in progress/.test(r.stdout), r.stdout);
  console.log('ok - usage shows the limits only');

  r = cli('ci-eta', 'build', '4m');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(S.load(tmp).ciEta.build.sec, 240);
  r = cli('ci-eta', 'build', 'soon');
  assert.notStrictEqual(r.status, 0, 'a bad time is refused');
  r = cli('ci-eta', 'clear', 'build');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(S.load(tmp).ciEta.build, undefined);
  console.log('ok - ci-eta: set, refuse a bad time, clear');
} finally {
  USAGE.setFetchForTests(null);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('all usage tests passed');
