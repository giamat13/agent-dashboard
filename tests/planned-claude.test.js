// Tests for Claude's side of planned usage (claude-plugin/scripts/lib/planned.js: plan set, plan history), and that the
// VS Code extension (vscode-extension/lib/planned.js) reads what Claude writes, on the same file.
// Run: node tests/planned-claude.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../claude-plugin/scripts/lib/planned');
const P = require('../vscode-extension/lib/planned');

const reading = (five, weekly) => ({
  fiveHour: { pct: five, resetsAt: 'r5' }, weekly: { pct: weekly, resetsAt: 'rw' },
});
const sessions = (statuses) => ({ s1: { todos: statuses.map((status, i) => ({ id: String(i + 1), content: 'Step ' + (i + 1) + ' of the list', status })) } });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-plan-claude-'));
try {
  // 1. Nothing finished yet: history says so.
  assert.match(C.history(tmp), /No finished tasks yet/);
  console.log('ok - history with no finished task says so');

  // 2. plan set writes the estimate into the shared file, with 0 and text numbers read as given.
  const e = C.set(tmp, 's1', { five: '12', weekly: '0', why: 'three steps' }, 1000);
  assert.deepStrictEqual(e, { five: 12, weekly: 0, why: 'three steps', at: 1000 });
  assert.deepStrictEqual(C.read(tmp).plan, { s1: { five: 12, weekly: 0, why: 'three steps', at: 1000 } });
  console.log('ok - plan set stores the estimate in the shared file');

  // 3. Bad input is refused, so Claude is told and nothing is stored.
  assert.throws(() => C.set(tmp, 's1', {}, 1000), /Give the points/);
  assert.throws(() => C.set(tmp, 's1', { five: true, weekly: '-4' }, 1000), /Give the points/, 'a flag without a value is not a number');
  assert.throws(() => C.set(tmp, '', { five: 3 }, 1000), /no session id/);
  assert.deepStrictEqual(Object.keys(C.read(tmp).plan), ['s1'], 'refused calls store nothing');
  console.log('ok - plan set refuses empty or bad numbers and a missing session');

  // 4. The extension takes the estimate when the task starts, and the task is recorded with it when it ends.
  let store = P.read(tmp);
  assert.strictEqual(P.track(store, sessions(['in_progress', 'pending']), reading(10, 20), 2000), true);
  P.write(tmp, store);
  assert.deepStrictEqual(C.read(tmp).open.s1.estimate, { five: 12, weekly: 0, why: 'three steps' });
  assert.deepStrictEqual(C.read(tmp).plan, {}, 'the pending estimate moved into the running task');
  console.log('ok - the extension takes Claude\'s estimate when the task starts');

  store = P.read(tmp);
  P.track(store, sessions(['completed', 'completed']), reading(22, 20), 3000);
  P.write(tmp, store);

  // 5. History now shows the finished task with its items, the limit it used, and the estimate, for Claude to compare.
  const h = C.history(tmp);
  assert.match(h, /5-hour \+12/, 'the measured share');
  assert.match(h, /weekly \+0/, 'a weekly share of 0');
  assert.match(h, /estimate 5-hour \+12, weekly \+0 \(three steps\)/, 'the estimate that was set');
  assert.match(h, /· Step 1 of the list/, 'the TODO items');
  console.log('ok - history shows the finished task, its items and the estimate that was set');

  // 6. History keeps the last ten finished tasks only, newest last.
  for (let i = 0; i < 12; i++) {
    const s = P.read(tmp);
    s.records.push({ at: i, secs: 60, five: i, weekly: null, items: 1, titles: ['old ' + i] });
    P.write(tmp, s);
  }
  const lines = C.history(tmp).split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 10, 'only the last ten are shown');
  assert.match(lines[lines.length - 1], /5-hour \+11 /, 'newest last');
  console.log('ok - history shows the last ten finished tasks, newest last');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('all planned-claude tests passed');
