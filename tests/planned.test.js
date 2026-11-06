// Tests for the planned share of the usage limits in media/main.js (planInfo, plannedOf, bar, usageHtml).
// Run: node tests/planned.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'vscode-extension', 'media', 'main.js'), 'utf8');

// The webview script runs inside one IIFE, so each helper is cut out by its name and run as it is written there.
function grab(name) {
  const at = src.indexOf('  function ' + name + '(');
  assert.ok(at >= 0, name + ' not found in media/main.js');
  return src.slice(at, src.indexOf('\n  }\n', at) + '\n  }\n'.length);
}
const barAt = src.indexOf('  const bar = (pct, cls, plan) => {');
assert.ok(barAt >= 0, 'bar not found in media/main.js');
const barSrc = src.slice(barAt, src.indexOf('\n  };\n', barAt) + '\n  };\n'.length);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { bar, planInfo, plannedOf, usageHtml } = new Function('esc', 'resetDur', [
  barSrc, grab('planInfo'), grab('plannedOf'), grab('usageHtml'), 'return { bar: bar, planInfo: planInfo, plannedOf: plannedOf, usageHtml: usageHtml };',
].join('\n'))(esc, (s) => s + 's'); // the reset time is not part of these tests

const T = 1000;
const start = { at: T, weekly: 10, fiveHour: 40 };
const est = (over) => Object.assign({ kind: 'similar', n: 3, model: 'opus', sameModel: true, weekly: 8, fiveHour: 20, at: T }, over);
const task = (s, e) => ({ text: 'Write the readme', start: s, est: e });   // the whole task (st.usageTask)
const usage = (fiveHour, weekly) => ({ fiveHour: { pct: fiveHour, resetsAt: null }, weekly: { pct: weekly, resetsAt: null }, opus: null, fetchedAt: T });

try {
  // The planned part is the estimate minus what this task has used so far. The text is the share expected at 100% progress:
  // where the task started plus the estimate.
  assert.deepStrictEqual(planInfo(task(start, est()), 'weekly', usage(45, 14)), { width: 4, text: 'planned at 100%: ~18% (3 similar tasks, opus)' });
  assert.deepStrictEqual(planInfo(task(start, est()), 'fiveHour', usage(45, 14)), { width: 15, text: 'planned at 100%: ~60% (3 similar tasks, opus)' });
  console.log('ok - planned = estimate minus what the task has used; text = share at 100%');

  // Never more than what is left of the limit; the text stops at 100%.
  const capped = planInfo(task({ at: T, weekly: 50, fiveHour: 50 }, est({ weekly: 80 })), 'weekly', usage(60, 60));
  assert.strictEqual(capped.width, 40);
  assert.ok(capped.text.startsWith('planned at 100%: ~100%'), capped.text);
  console.log('ok - capped at what is left of the limit');

  // The average of a model, and similar tasks of other models.
  assert.ok(planInfo(task(start, est({ kind: 'average', n: 1, model: 'haiku' })), 'weekly', usage(45, 14)).text.includes('average of 1 task, haiku'));
  assert.ok(planInfo(task(start, est({ sameModel: false, n: 2, model: 'opus' })), 'weekly', usage(45, 14)).text.includes('2 similar tasks, other model'));
  console.log('ok - text: average of a model, other model');

  // No estimate yet: "no data yet". No numbers for this task, or no number for this limit: nothing planned.
  assert.deepStrictEqual(planInfo(task(start, undefined), 'weekly', usage(45, 14)), { width: 0, text: 'no data yet' });
  assert.strictEqual(planInfo({ text: 'x', start: null }, 'weekly', usage(45, 14)), null, 'no start: nothing planned');
  assert.strictEqual(planInfo(task(start, est()), 'opus', usage(45, 14)), null);
  console.log('ok - no estimate: "no data yet"; no numbers: nothing planned');

  // The newest open task (the whole list), from this session or from another one. A task without a start is not picked.
  const st = {
    usageTask: { text: 'a', start: { at: 5 } },
    sessions: {
      a: { usageTask: undefined },
      b: { usageTask: { text: 'b', start: { at: 9 } } },
      c: { usageTask: { text: 'c', start: null } },
    },
  };
  assert.strictEqual(plannedOf(st).start.at, 9);
  assert.strictEqual(plannedOf({ usageTask: null, sessions: {} }), null);
  assert.strictEqual(plannedOf(null), null);
  console.log('ok - the newest open task is picked');

  // The striped part starts where the used part ends and never runs past the end of the bar.
  assert.ok(bar(90, 'bad', { width: 30 }).includes('left:90%;width:10%'));
  assert.ok(!bar(20, 'ok').includes('class="u"'));
  assert.ok(!bar(20, 'ok', { width: 0 }).includes('class="u"'));
  console.log('ok - bar: striped part after the used part, capped at 100%');

  // The usage card: the planned share on the two limit bars, and hidden when the switch is off.
  const withPlan = usageHtml(usage(45, 14), Date.now(), task(start, est()), true);
  assert.ok(withPlan.includes('left:14%;width:4%'), 'striped part on the weekly bar');
  assert.ok(withPlan.includes('left:45%;width:15%'), 'striped part on the 5-hour bar');
  assert.ok(withPlan.includes('planned at 100%: ~18% (3 similar tasks, opus)') && withPlan.includes('planned at 100%: ~60%'), 'text on both rows');
  assert.ok(!usageHtml(usage(45, 14), Date.now(), task(start, est()), false).includes('planned'), 'switch off: nothing planned');
  assert.ok(!usageHtml(usage(45, 14), Date.now(), null, true).includes('planned'), 'no task in progress: nothing planned');
  assert.ok(usageHtml({ error: 'not-logged-in' }, Date.now(), null, true).includes('Not signed in'));
  console.log('ok - usage card: planned share on both bars, hidden when off');
} finally {
  // nothing to clean up: the tests read the script and make no files
}

console.log('all planned tests passed');
