// Tests for the plan-usage estimate (claude-plugin/scripts/lib/usage.js) and its commands (dash.js usage, ci-eta).
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
const entry = (text, model, weekly, fiveHour, at = 1) => ({ text, model, weekly, fiveHour, at });
const newSt = (log) => ({ context: { model: 'claude-opus-5-5' }, usageLog: (log || []).slice() });
const BOTH = { usageEstimate: true, usageRecord: true };
const LOG = [
  entry('Write the readme file', 'opus', 2, 1),
  entry('Write the readme', 'opus', 4, 3),
  entry('Fix the login bug', 'opus', 9, 7),
  entry('Write the readme', 'sonnet', 100, 100),
  { text: 'Write the readme', model: 'opus', weekly: null, fiveHour: 5, at: 1 }, // no number: ignored
];

try {
  // Helpers.
  assert.strictEqual(USAGE.similarity(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.strictEqual(USAGE.similarity(new Set(['a']), new Set(['b'])), 0);
  assert.strictEqual(USAGE.similarity(new Set(), new Set()), 0);
  assert.ok(Math.abs(USAGE.similarity(new Set(['write', 'readme']), new Set(['write', 'readme', 'file'])) - 2 / 3) < 1e-9);
  assert.strictEqual(USAGE.median([3, 1, 2]), 2);
  assert.strictEqual(USAGE.median([4, 1, 3, 2]), 2.5);
  assert.strictEqual(USAGE.plainText({ content: 'Write the readme ~5m' }), 'Write the readme');
  assert.strictEqual(USAGE.plainText({ content: 'Fix the bug ~1.5h' }), 'Fix the bug');
  assert.strictEqual(USAGE.plainText({ content: 'No estimate here' }), 'No estimate here');
  assert.strictEqual(USAGE.family('claude-opus-5-5'), 'opus');
  assert.strictEqual(USAGE.family('claude-sonnet-5-5'), 'sonnet');
  assert.strictEqual(USAGE.family('claude-haiku-5-5'), 'haiku');
  console.log('ok - similarity, median, task text and model families');

  // Similar tasks of the same model: the unrelated task and the other model are left out.
  let est = USAGE.estimate(newSt(LOG), 'Write the readme', 'claude-opus-5-5');
  assert.deepStrictEqual(est, { kind: 'similar', n: 2, model: 'opus', sameModel: true, weekly: 3, fiveHour: 2 });
  console.log('ok - similar tasks of the same model');

  // No similar task of the same model: similar tasks of other models are used, and it says so.
  est = USAGE.estimate(newSt(LOG), 'Write the readme', 'claude-haiku-5-5');
  assert.deepStrictEqual(est, { kind: 'similar', n: 3, model: 'haiku', sameModel: false, weekly: 4, fiveHour: 3 });
  console.log('ok - other models are used when the model has no similar task');

  // Nothing similar: the average of all tasks of that model.
  est = USAGE.estimate(newSt(LOG), 'Deploy the server', 'claude-opus-5-5');
  assert.deepStrictEqual(est, { kind: 'average', n: 3, model: 'opus', sameModel: true, weekly: 5, fiveHour: 3.7 });
  console.log('ok - average of the model when nothing is similar');

  // No data at all: no estimate.
  assert.strictEqual(USAGE.estimate(newSt([]), 'Write the readme', 'claude-opus-5-5'), null);
  console.log('ok - no data gives no estimate');

  // At most 5 similar tasks, the newest first when they are equally similar.
  const recent = [
    entry('Write the readme', 'opus', 1, 1, 10), entry('Write the readme', 'opus', 50, 50, 20),
    entry('Write the readme', 'opus', 60, 60, 30), entry('Write the readme', 'opus', 70, 70, 40),
    entry('Write the readme', 'opus', 80, 80, 50), entry('Write the readme', 'opus', 90, 90, 60),
  ];
  est = USAGE.estimate(newSt(recent), 'Write the readme', 'claude-opus-5-5');
  assert.strictEqual(est.n, 5);
  assert.strictEqual(est.weekly, 70); // the five newest: 90, 80, 70, 60, 50
  console.log('ok - at most 5 similar tasks, the newest first');

  // A task starts: the limits are noted with the estimate. It ends a minute later: what it used goes into the log.
  reading = ok(40, 10);
  let st = newSt(LOG);
  let t = { id: '1', content: 'Write the readme ~5m', status: 'in_progress' };
  USAGE.startTask(st, t, 1000, BOTH);
  assert.deepStrictEqual(t.usageStart, { at: 1000, weekly: 10, fiveHour: 40 });
  assert.strictEqual(t.usageEst.kind, 'similar');
  assert.strictEqual(t.usageEst.at, 1000);
  reading = ok(45, 14);
  USAGE.finishTask(st, t, 61000, BOTH);
  assert.strictEqual(t.usageStart, undefined);
  assert.strictEqual(t.usageEst, undefined);
  assert.deepStrictEqual(st.usageLog[st.usageLog.length - 1], { text: 'Write the readme', model: 'opus', weekly: 4, fiveHour: 5, at: 61000 });
  assert.strictEqual(st.usageLog.length, LOG.length + 1);
  console.log('ok - a finished task is recorded: weekly +4%, 5-hour +5%');

  // A limit that went down during the task was reset in between: nothing is recorded.
  st = newSt();
  t = { id: '1', content: 'Build it', status: 'in_progress' };
  reading = ok(50, 50);
  USAGE.startTask(st, t, 1000, BOTH);
  reading = ok(5, 5);
  USAGE.finishTask(st, t, 61000, BOTH);
  assert.strictEqual(st.usageLog.length, 0);
  console.log('ok - a limit reset during a task is not recorded');

  // Switches: with both off nothing is read; each one works on its own.
  asked = 0;
  reading = ok(20, 20);
  st = newSt(LOG);
  t = { id: '1', content: 'Write the readme', status: 'in_progress' };
  USAGE.startTask(st, t, 1000, { usageEstimate: false, usageRecord: false });
  USAGE.finishTask(st, t, 61000, { usageEstimate: false, usageRecord: false });
  assert.strictEqual(asked, 0, 'both off: the usage endpoint is not asked');
  assert.strictEqual(t.usageStart, undefined);
  assert.strictEqual(st.usageLog.length, LOG.length);

  st = newSt(LOG);
  t = { id: '1', content: 'Write the readme', status: 'in_progress' };
  USAGE.startTask(st, t, 1000, { usageEstimate: true, usageRecord: false });
  assert.ok(t.usageStart && t.usageEst, 'estimate only: the start and the estimate are kept');
  USAGE.finishTask(st, t, 61000, { usageEstimate: true, usageRecord: false });
  assert.strictEqual(st.usageLog.length, LOG.length, 'estimate only: nothing is recorded');

  st = newSt(LOG);
  t = { id: '1', content: 'Write the readme', status: 'in_progress' };
  USAGE.startTask(st, t, 1000, { usageEstimate: false, usageRecord: true });
  assert.ok(t.usageStart, 'record only: the start is kept');
  assert.strictEqual(t.usageEst, undefined, 'record only: no estimate');
  console.log('ok - switches: both off reads nothing; each one works alone');

  // The endpoint fails: no numbers, and it is not asked again until the wait is over.
  asked = 0;
  reading = { ok: false, error: 'network' };
  st = newSt();
  t = { id: '1', content: 'Write the readme', status: 'in_progress' };
  USAGE.startTask(st, t, 1000, BOTH);
  assert.strictEqual(t.usageStart, undefined);
  assert.strictEqual(st.usageSnap.ok, false);
  assert.strictEqual(st.usageSnap.retryAt, 1000 + 60 * 1000);
  const before = asked;
  USAGE.startTask(st, t, 30000, BOTH);
  assert.strictEqual(asked, before, 'while waiting: not asked');
  reading = ok(30, 30);
  assert.ok(USAGE.current(st, 61001), 'after the wait: asked again');
  console.log('ok - a failed read is not repeated for a minute');

  // Rate limited: the wait is ten minutes.
  reading = { ok: false, status: 429 };
  st = newSt();
  assert.strictEqual(USAGE.current(st, 1000), null);
  assert.strictEqual(st.usageSnap.error, 'http 429');
  assert.strictEqual(st.usageSnap.retryAt, 1000 + 10 * 60 * 1000);
  console.log('ok - a rate limit waits ten minutes');

  // A reading younger than 20 seconds is reused.
  reading = ok(1, 1);
  st = newSt();
  USAGE.current(st, 1000);
  const once = asked;
  USAGE.current(st, 5000);
  assert.strictEqual(asked, once, 'a reading younger than 20 seconds is reused');
  console.log('ok - a fresh reading is reused');

  // No login file: the real child process reports it, and nothing is read.
  USAGE.setFetchForTests(null);
  st = newSt();
  assert.strictEqual(USAGE.current(st, 1000), null);
  assert.strictEqual(st.usageSnap.error, 'not-logged-in');
  console.log('ok - without a login nothing is read');

  // The command line, in the temp folder.
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: tmp, AGENT_DASH_HOME: tmp, USERPROFILE: tmp, HOME: tmp });
  const cli = (...args) => spawnSync(process.execPath, [DASH, ...args], { env, encoding: 'utf8', timeout: 30000 });
  let r = cli('todo', 'set', '[~] Write the readme ~5m|[ ] Fix the login bug');
  assert.strictEqual(r.status, 0, r.stderr);
  r = cli('usage', '--json');
  assert.strictEqual(r.status, 0, r.stderr);
  const info = JSON.parse(r.stdout);
  assert.strictEqual(info.error, 'not-logged-in');
  assert.strictEqual(info.weekly, null);
  assert.strictEqual(info.task, 'Write the readme');
  assert.strictEqual(info.expected, null);
  r = cli('usage');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/Weekly limit: \?/.test(r.stdout) && /Task in progress: Write the readme/.test(r.stdout), r.stdout);
  r = cli('todo', 'doing', '2');
  assert.strictEqual(r.status, 0, r.stderr);
  r = cli('todo', 'done', '2');
  assert.strictEqual(r.status, 0, r.stderr);
  console.log('ok - usage and todo commands work without a login');

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
