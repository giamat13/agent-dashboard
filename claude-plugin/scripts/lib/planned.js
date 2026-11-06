'use strict';
// Claude's side of planned usage, for dash.js:
//   plan history          the finished tasks: their TODO items, the limit they used, and the estimate that was set for them
//   plan set --five <points> --weekly <points> --why "<reason>"   Claude's estimate for the session's next task
// The VS Code extension keeps the file (vscode-extension/lib/planned.js, the same format): <folder>/.agent-dashboard/planned.json.
// A set estimate waits in "plan" until the next task starts, then the extension shows it on the usage card.
const fs = require('fs');
const path = require('path');

const FILE = 'planned.json';
const DIR = '.agent-dashboard';
const SHOWN = 10;   // finished tasks shown by plan history

function fileOf(folder) { return path.join(folder, DIR, FILE); }

function read(folder) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(folder), 'utf8'));
    return {
      open: j.open && typeof j.open === 'object' ? j.open : {},
      records: Array.isArray(j.records) ? j.records : [],
      plan: j.plan && typeof j.plan === 'object' ? j.plan : {},
    };
  } catch {
    return { open: {}, records: [], plan: {} };
  }
}

// Throws when the file cannot be written: the caller tells Claude, so the estimate is never lost without a word.
function write(folder, store) {
  const dir = path.join(folder, DIR);
  fs.mkdirSync(dir, { recursive: true });
  const f = fileOf(folder);
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, f);
}

// A number of points (0 to 100 and more is allowed, the card caps the line). Strings from the command line are read too.
function points(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null;
}

// Sets the estimate of the session's next task. Returns the stored estimate.
function set(folder, sessionId, args, now) {
  if (!sessionId) throw new Error('This chat has no session id yet. Send one message in the chat first, then run plan set again.');
  const five = points(args.five), weekly = points(args.weekly);
  if (five === null && weekly === null) throw new Error('Give the points of the limit the task will use: plan set --five <points> --weekly <points> --why "<reason>". Use 0 for a limit the task will not touch.');
  const store = read(folder);
  store.plan[sessionId] = { five, weekly, why: String(args.why || '').slice(0, 200), at: now };
  write(folder, store);
  return store.plan[sessionId];
}

const when = (at) => (typeof at === 'number' ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : '?');
const pct = (x) => (typeof x === 'number' ? '+' + x : 'not measured');
const est = (e) => {
  if (!e) return 'no estimate set';
  const parts = [];
  if (typeof e.five === 'number') parts.push('5-hour +' + e.five);
  if (typeof e.weekly === 'number') parts.push('weekly +' + e.weekly);
  return 'estimate ' + parts.join(', ') + (e.why ? ' (' + e.why + ')' : '');
};

// The text plan history prints: one block per finished task, newest last, so Claude can compare the new list with them.
function history(folder, n) {
  const store = read(folder);
  const last = store.records.slice(-(n || SHOWN));
  if (!last.length) return 'No finished tasks yet. Choose the estimate from the TODO list itself, and say why in --why.';
  const lines = ['Finished tasks, oldest first. Numbers are the share of the limit the whole task used (points of 100).'];
  for (const r of last) {
    lines.push('');
    lines.push('- ' + when(r.at) + ' · ' + Math.round((r.secs || 0) / 60) + ' min · 5-hour ' + pct(r.five) + ' · weekly ' + pct(r.weekly) + ' · ' + (r.items || 0) + ' items · ' + est(r.estimate));
    for (const t of r.titles || []) lines.push('    · ' + t);
  }
  return lines.join('\n');
}

// One short line for the hook to add to a new task, so Claude can set its estimate without a separate "plan history" call.
function compact(folder, n) {
  const last = read(folder).records.slice(-(n || 4));
  const short = (e) => (e ? (typeof e.five === 'number' ? e.five : '?') + '/' + (typeof e.weekly === 'number' ? e.weekly : '?') : '-');
  if (!last.length) return 'Planned usage: no past tasks yet; estimate from the size of the TODO list.';
  return 'Planned usage, past tasks (items, minutes, used 5h/weekly points, your estimate): ' +
    last.map((r) => (r.items || 0) + ' items ' + Math.round((r.secs || 0) / 60) + 'm used ' + short(r) + ' est ' + short(r.estimate)).join('; ') + '.';
}

module.exports = { FILE, DIR, read, write, set, history, compact, points };
