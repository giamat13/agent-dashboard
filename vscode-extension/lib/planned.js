'use strict';
// Planned usage: how far the 5-hour and weekly limits are expected to go when the running task ends.
// A task is the whole TODO list of one session. It starts when an item is in progress, and it ends when every item is completed.
// The usage at the start and at the end is kept (percentages and reset times only, in <folder>/.agent-dashboard/planned.json).
// The estimate of a task is Claude's own: Claude reads the finished tasks and sets it (plan set, claude-plugin/scripts/lib/planned.js),
// and it waits in store.plan until the task starts. Without one, the estimate is the median of the last finished tasks.
// Pure logic here; the extension reads and writes the file.
const fs = require('fs');
const path = require('path');

const FILE = 'planned.json';
const KEEP = 20;                      // finished tasks kept in the file
const USE = 10;                       // the estimate uses the last 10 finished tasks
const MAX_OPEN_MS = 8 * 3600 * 1000;  // a task that never finishes is dropped after this long; so is an estimate no task picked up
const TITLES = 12, TITLE_LEN = 80;    // TODO items kept per finished task, so Claude can compare the tasks

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round1 = (x) => Math.round(x * 10) / 10;
const num = (v) => (typeof v === 'number' || typeof v === 'string') && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? round1(Number(v)) : null;

// Claude's estimate as it is stored: { five, weekly, why }. A window Claude did not give is null. Null when neither is given.
function plannedEst(p) {
  if (!p || typeof p !== 'object') return null;
  const five = num(p.five), weekly = num(p.weekly);
  if (five === null && weekly === null) return null;
  return { five, weekly, why: typeof p.why === 'string' ? p.why.slice(0, 200) : '' };
}

// The TODO items of a task, short, for the record.
function titles(todos) {
  return todos.map((t) => String(t && t.content || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_LEN)).filter(Boolean).slice(0, TITLES);
}

// The two windows from one usage reading (lib of the extension: { fiveHour: { pct, resetsAt }, weekly: { ... } }).
function snap(usage) {
  if (!usage || usage.error || (!usage.fiveHour && !usage.weekly)) return null;
  const f = usage.fiveHour, w = usage.weekly;
  return {
    five: f ? f.pct : null, fiveReset: f ? f.resetsAt : null,
    weekly: w ? w.pct : null, weeklyReset: w ? w.resetsAt : null,
  };
}

// The change of one window over the task. Null when a limit reset happened in between (the numbers do not add up) or the usage went down.
function delta(a, b, resetA, resetB) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if ((resetA ?? null) !== (resetB ?? null)) return null;
  if (b < a) return null;
  return round1(b - a);
}

// The record of a finished task: what it used, its TODO items, and the estimate that was set for it (if any).
function finish(open, end, now, todos) {
  if (!open.start || !end) return null;
  const rec = {
    at: now,
    secs: Math.round((now - open.startedAt) / 1000),
    five: delta(open.start.five, end.five, open.start.fiveReset, end.fiveReset),
    weekly: delta(open.start.weekly, end.weekly, open.start.weeklyReset, end.weeklyReset),
    items: todos.length,
    titles: titles(todos),
  };
  if (open.estimate) rec.estimate = open.estimate;
  return rec.five === null && rec.weekly === null ? null : rec;
}

// Updates the store from the sessions' TODO lists and the latest usage reading. Returns true when the store changed.
function track(store, sessions, usage, now) {
  let changed = false;
  const list = sessions && typeof sessions === 'object' ? sessions : {};
  const reading = snap(usage);
  store.plan = store.plan && typeof store.plan === 'object' ? store.plan : {};
  for (const id of Object.keys(store.plan)) {
    if (!store.plan[id] || now - (store.plan[id].at || 0) > MAX_OPEN_MS) { delete store.plan[id]; changed = true; }
  }
  for (const id of Object.keys(store.open)) {
    const o = store.open[id];
    if (!(id in list) || now - o.startedAt > MAX_OPEN_MS) { delete store.open[id]; changed = true; }
  }
  for (const [id, ss] of Object.entries(list)) {
    const todos = ss && Array.isArray(ss.todos) ? ss.todos : [];
    const open = store.open[id];
    if (!todos.length) { if (open) { delete store.open[id]; changed = true; } continue; }
    const pending = store.plan[id] ? plannedEst(store.plan[id]) : null;   // Claude's estimate for this session's next task
    const allDone = todos.every((t) => t.status === 'completed');
    if (open) {
      if (store.plan[id]) { open.estimate = pending; delete store.plan[id]; changed = true; }
      if (allDone) {
        const rec = finish(open, reading, now, todos);
        if (rec) store.records.push(rec);
        if (store.records.length > KEEP) store.records.splice(0, store.records.length - KEEP);
        delete store.open[id];
        changed = true;
      }
    } else if (!allDone && reading && todos.some((t) => t.status === 'in_progress')) {
      store.open[id] = { startedAt: now, start: reading, estimate: pending };
      delete store.plan[id];
      changed = true;
    }
  }
  return changed;
}

// The estimate in points of each window: the median of the last finished tasks that measured it.
function estimate(store) {
  const last = store.records.slice(-USE);
  const pick = (k) => {
    const xs = last.map((r) => r[k]).filter((x) => typeof x === 'number' && x >= 0);
    return xs.length ? median(xs) : null;
  };
  return { five: pick('five'), weekly: pick('weekly'), count: last.length };
}

// What the usage card shows: for the window of the running task (the latest one started), the expected share when it ends.
// Claude's points win; a window Claude did not give uses the history. Null when no task runs or there is no number at all.
// A window that reset since the task started is left out.
function view(store, usage) {
  const open = Object.values(store.open).sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!open || !open.start) return null;
  const est = estimate(store);
  const own = open.estimate || null;
  const one = (win, startPct, startReset, key, histPoints) => {
    const mine = own && typeof own[key] === 'number' ? own[key] : null;
    const points = mine !== null ? mine : histPoints;
    if (typeof startPct !== 'number' || points === null || points === undefined) return null;
    if (win && (win.resetsAt ?? null) !== (startReset ?? null)) return null;
    return {
      expect: round1(startPct + points), points: round1(points), count: est.count,
      by: mine !== null ? 'claude' : 'history', why: mine !== null ? own.why || '' : null,
    };
  };
  const out = {
    fiveHour: one(usage && usage.fiveHour, open.start.five, open.start.fiveReset, 'five', est.five),
    weekly: one(usage && usage.weekly, open.start.weekly, open.start.weeklyReset, 'weekly', est.weekly),
  };
  return out.fiveHour || out.weekly ? out : null;
}

function fileOf(folder) { return path.join(folder, '.agent-dashboard', FILE); }

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

function write(folder, store) {
  try {
    const dir = path.join(folder, '.agent-dashboard');
    fs.mkdirSync(dir, { recursive: true });
    const f = fileOf(folder);
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, f);
  } catch { /* the estimate is optional: the dashboard works without it */ }
}

module.exports = { FILE, KEEP, USE, TITLES, snap, delta, finish, titles, plannedEst, track, estimate, view, read, write };
