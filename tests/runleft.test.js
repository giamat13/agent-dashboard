// Fixture tests for the "Total left" rule.
// lib/state.js runLeft (used by dash.js and hook.js) and media/main.js runLeftOf (the dashboard) must give the same answer.
// Run: node tests/runleft.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../claude-plugin/scripts/lib/state');

const NOW = 1700000000000;
const src = fs.readFileSync(path.join(__dirname, '..', 'vscode-extension', 'media', 'main.js'), 'utf8');

// Take the same two pieces out of the webview script, so the test runs the code the dashboard runs.
const etaLeftSrc = /^\s*const etaLeft = .*;$/m.exec(src)[0].trim();
const at = src.indexOf('function runLeftOf(');
assert.ok(at >= 0, 'runLeftOf not found in media/main.js');
const runLeftOfSrc = src.slice(at, src.indexOf('\n  }\n', at) + '\n  }\n'.length);
const webRunLeftOf = (hist) => new Function('hist', etaLeftSrc + '\n' + runLeftOfSrc + '\nreturn runLeftOf;')(hist);

const step = (title, status, extra) => Object.assign({ title, status }, extra || {});
const run = (steps, extra) => Object.assign({ title: 'Full tests', status: 'running', steps }, extra || {});
// Step A is running: planned 120 s, started 60 s ago, so 60 s left. B is still to do.
const doingA = (extra) => step('A', 'doing', Object.assign({ startedAt: NOW - 60000, etaSetAt: NOW - 60000, etaSeconds: 120 }, extra || {}));

function check(name, r, hist, want) {
  const cur = r.steps.find((s) => s.status === 'doing');
  const results = { 'lib/state.js': S.runLeft(r, NOW, hist), 'media/main.js': webRunLeftOf(hist)(r, cur, NOW) };
  for (const who of Object.keys(results)) {
    const x = results[who];
    assert.strictEqual(x.source, want.source, `${name} (${who}): source`);
    assert.strictEqual(x.explicit, want.explicit, `${name} (${who}): explicit`);
    if (want.sec !== undefined) assert.strictEqual(x.sec, want.sec, `${name} (${who}): sec`);
    if (want.computed !== undefined) assert.strictEqual(x.computed, want.computed, `${name} (${who}): computed`);
  }
  console.log('ok - ' + name);
}

check("Claude's total covers the steps: its number is shown",
  run([doingA(), step('B', 'todo')], { etaSeconds: 600, etaSetAt: NOW }),
  {}, { source: 'claude', sec: 600, explicit: 600, computed: 180 });

check('Stale total (7 s, steps still to do): the steps decide',
  run([doingA(), step('B', 'todo')], { etaSeconds: 7, etaSetAt: NOW }),
  {}, { source: 'computed', sec: 180, explicit: 7, computed: 180 });

check('No total at all: the steps decide',
  run([doingA(), step('B', 'todo')]),
  {}, { source: 'computed', sec: 180, explicit: null, computed: 180 });

check('Expired total with steps still to do',
  run([doingA(), step('B', 'todo')], { etaSeconds: 10, etaSetAt: NOW - 60000 }),
  {}, { source: 'computed', sec: 180, explicit: -50, computed: 180 });

check('Next step uses its history estimate (30 s) instead of the average',
  run([doingA(), step('B', 'todo'), step('C', 'todo')]),
  { 'step:Full tests/B': 30 }, { source: 'computed', sec: 210, explicit: null, computed: 210 });

check("A step's own estimate (90 s) beats its history (30 s)",
  run([doingA(), step('B', 'todo', { etaSeconds: 90 }), step('C', 'todo')]),
  { 'step:Full tests/B': 30 }, { source: 'computed', sec: 270, explicit: null, computed: 270 });

check('Finished step (60 s) sets the average',
  run([step('X', 'done', { startedAt: NOW - 300000, endedAt: NOW - 240000 }), doingA(), step('B', 'todo')], { etaSeconds: 500, etaSetAt: NOW }),
  {}, { source: 'claude', sec: 500, explicit: 500, computed: 120 });

check('Nothing known yet: no estimate',
  run([step('A', 'todo'), step('B', 'todo')]),
  {}, { source: null, explicit: null });

check('No steps, only a total: the total is shown',
  run([], { etaSeconds: 300, etaSetAt: NOW }),
  {}, { source: 'claude', sec: 300, explicit: 300, computed: null });

check('No steps and no total: no estimate',
  run([]),
  {}, { source: null, explicit: null });

console.log('all Total left tests passed');
