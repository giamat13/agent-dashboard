// Tests for the planned usage (vscode-extension/lib/planned.js): when a task starts and ends, what is left out, and the estimate.
// Run: node tests/planned.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../vscode-extension/lib/planned');

// A usage reading: the two windows with their percentages and reset times.
const reading = (five, weekly, fiveReset = 'r5', weeklyReset = 'rw') => ({
  fiveHour: { pct: five, resetsAt: fiveReset }, weekly: { pct: weekly, resetsAt: weeklyReset },
});
const todos = (...statuses) => statuses.map((status, i) => ({ id: String(i + 1), content: 'item ' + i, status }));
const sessions = (list) => ({ s1: { todos: list } });
const empty = () => ({ open: {}, records: [] });

// 1. A task starts with the first item in progress and is recorded when every item is completed.
{
  const st = empty();
  assert.strictEqual(P.track(st, sessions(todos('pending', 'pending')), reading(10, 20), 1000), false, 'nothing in progress: no task');
  assert.strictEqual(P.track(st, sessions(todos('in_progress', 'pending')), reading(10, 20), 2000), true, 'first item in progress: task starts');
  assert.strictEqual(P.track(st, sessions(todos('completed', 'in_progress')), reading(25, 22), 3000), false, 'still running: nothing recorded');
  assert.strictEqual(P.track(st, sessions(todos('completed', 'completed')), reading(30, 25), 4000), true, 'all completed: task recorded');
  assert.deepStrictEqual(st.records, [{ at: 4000, secs: 2, five: 20, weekly: 5 }]);
  assert.deepStrictEqual(st.open, {});
  console.log('ok - a task runs from its first item in progress to the last completed item');
}

// 2. A window that reset during the task is left out; the other window is still counted.
{
  const st = empty();
  P.track(st, sessions(todos('in_progress')), reading(10, 20, 'r5', 'rw'), 1000);
  P.track(st, sessions(todos('completed')), reading(3, 24, 'r5-new', 'rw'), 2000);
  assert.deepStrictEqual(st.records, [{ at: 2000, secs: 1, five: null, weekly: 4 }]);
  console.log('ok - a window that reset during the task is left out');
}

// 3. No usage reading when the task ends: the task closes, nothing is recorded.
{
  const st = empty();
  P.track(st, sessions(todos('in_progress')), reading(10, 20), 1000);
  P.track(st, sessions(todos('completed')), null, 2000);
  assert.deepStrictEqual(st.records, []);
  assert.deepStrictEqual(st.open, {});
  console.log('ok - without a usage reading at the end nothing is recorded');
}

// 4. A session that goes away drops its running task without a record. A task with no reading at its start does not start.
{
  const st = empty();
  P.track(st, sessions(todos('in_progress')), reading(10, 20), 1000);
  P.track(st, {}, reading(12, 21), 2000);
  assert.deepStrictEqual(st.open, {});
  assert.deepStrictEqual(st.records, []);
  assert.strictEqual(P.track(st, sessions(todos('in_progress')), null, 3000), false, 'no reading: no task');
  console.log('ok - a removed session drops its task; no reading means no task');
}

// 5. The estimate is the median of the last ten finished tasks.
{
  const st = empty();
  st.records = [5, 1, 50, 3, 9, 7].map((five) => ({ at: 0, secs: 0, five, weekly: null }));
  assert.strictEqual(P.estimate(st).five, 6, 'median of 1, 3, 5, 7, 9, 50 is 6 (the two middle values averaged)');
  console.log('ok - the estimate is a median');
}
{
  const st = empty();
  st.records = [100, 100].concat(Array(10).fill(5)).map((five) => ({ at: 0, secs: 0, five, weekly: null }));
  const e = P.estimate(st);
  assert.strictEqual(e.five, 5, 'only the last ten count');
  assert.strictEqual(e.weekly, null, 'no weekly numbers: no weekly estimate');
  assert.strictEqual(e.count, 10);
  console.log('ok - only the last ten finished tasks count');
}

// 6. The card view: the expected share is the start plus the estimate, and it is left out when the window reset.
{
  const st = { open: { s1: { startedAt: 1000, start: { five: 10, fiveReset: 'r5', weekly: 20, weeklyReset: 'rw' } } }, records: [{ at: 1, secs: 1, five: 20, weekly: null }] };
  assert.deepStrictEqual(P.view(st, reading(15, 22)), { fiveHour: { expect: 30, points: 20, count: 1 }, weekly: null });
  assert.strictEqual(P.view(st, reading(15, 22, 'changed', 'rw')), null, 'five-hour window reset: no five-hour line');
  assert.strictEqual(P.view(empty(), reading(15, 22)), null, 'no task running: no view');
  console.log('ok - the view shows the expected share of the running task');
}

// 7. The file round-trips, and a missing file reads as empty.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-planned-'));
  try {
    P.write(tmp, { open: {}, records: [{ at: 1, secs: 2, five: 3, weekly: 4 }] });
    assert.deepStrictEqual(P.read(tmp).records, [{ at: 1, secs: 2, five: 3, weekly: 4 }]);
    assert.deepStrictEqual(P.read(path.join(tmp, 'missing')).records, []);
    console.log('ok - the store is written and read back');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('all planned tests passed');
