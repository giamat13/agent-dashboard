'use strict';
// מצב משותף בין התוסף של Claude לבין התוסף של VS Code: קובץ JSON אחד.
const fs = require('fs');
const path = require('path');

const DIR = '.agent-dashboard';

function findRoot(start) {
  if (process.env.AGENT_DASH_ROOT) return process.env.AGENT_DASH_ROOT;
  const orig = path.resolve(start || process.cwd());
  let d = orig;
  for (;;) {
    if (fs.existsSync(path.join(d, DIR))) return d;
    const p = path.dirname(d);
    if (p === d) return orig;
    d = p;
  }
}

const file = (root) => path.join(root, DIR, 'state.json');
const empty = () => ({ version: 1, todos: [], context: null, runs: [], goal: null, sessions: {}, activity: [], history: {}, lastReminderAt: 0, updatedAt: Date.now() });

// Live log: "what is happening right now" lines shown on the dashboard.
function logActivity(st, text, at) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) return;
  st.activity = st.activity || [];
  const last = st.activity[st.activity.length - 1];
  if (last && last.text === text) return;
  st.activity.push({ at: at || Date.now(), text });
  if (st.activity.length > 40) st.activity.splice(0, st.activity.length - 40);
}

// How long things took last time (seconds), used as the estimate for the next run. Keys: "run:<title>", "step:<run>/<step>", "job:<run>/<job>".
function histGet(st, key) {
  const v = st.history && st.history[key];
  return typeof v === 'number' && v > 0 ? v : null;
}
function histSet(st, key, sec) {
  if (!(sec > 0)) return;
  st.history = st.history || {};
  st.history[key] = Math.round(sec * 10) / 10;
  const ks = Object.keys(st.history);
  if (ks.length > 300) delete st.history[ks[0]];
}

function load(root) {
  try {
    return Object.assign(empty(), JSON.parse(fs.readFileSync(file(root), 'utf8')));
  } catch {
    return empty();
  }
}

function save(root, s) {
  const dir = path.join(root, DIR);
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  s.updatedAt = Date.now();
  if (s.runs.length > 20) s.runs = s.runs.slice(-20);
  const json = JSON.stringify(s, null, 1);
  const tmp = file(root) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, json);
  try {
    fs.renameSync(tmp, file(root));
  } catch {
    fs.writeFileSync(file(root), json);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// "90s", "5m", "1h30m", "2.5m"; מספר חשוף = דקות. מחזיר שניות או null.
function parseDuration(v) {
  if (v === undefined || v === null || v === true) return null;
  const str = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str) * 60);
  let total = 0, found = false;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) {
    found = true;
    total += parseFloat(m[1]) * { h: 3600, m: 60, s: 1 }[m[2]];
  }
  return found ? Math.round(total) : null;
}

function activeRun(st) {
  // Only this session's runs (runs without a session belong to everyone).
  return [...st.runs].reverse().find((r) => r.status === 'running' && (!r.session || !st.session || r.session === st.session));
}

// Seconds left for a running run, counted the same way as the dashboard (keep in sync with vscode-extension/media/main.js).
// Claude's total ("eta <time> --total") is used while it still covers the steps left. When it is missing, expired, or
// smaller than the steps still to do, the steps decide: the rest of the current step, plus each step still to do
// (its own estimate, else its history estimate, else the average of the finished steps). explicit = Claude's total, sec = the value shown.
function runLeft(r, now, hist) {
  const steps = r.steps || [];
  const at = (o) => (o && o.etaSetAt && typeof o.etaSeconds === 'number' ? (o.etaSetAt + o.etaSeconds * 1000 - now) / 1000 : null);
  const explicit = at(r);
  const cur = steps.find((s) => s.status === 'doing');
  const fin = steps.filter((s) => s.status === 'done' && s.startedAt && s.endedAt);
  const avg = fin.length ? fin.reduce((a, s) => a + (s.endedAt - s.startedAt) / 1000, 0) / fin.length
    : cur && typeof cur.etaSeconds === 'number' && cur.etaSetAt && cur.startedAt ? (cur.etaSetAt - cur.startedAt) / 1000 + cur.etaSeconds : null;
  const unknown = { sec: explicit, source: explicit === null ? null : 'claude', explicit, computed: null };
  if (!cur && avg === null) return unknown; // nothing started or finished yet: no step-based number
  let curLeft = 0;
  if (cur) {
    const l = at(cur);
    if (l !== null) curLeft = Math.max(0, l);
    else if (avg !== null && cur.startedAt) curLeft = Math.max(0, avg - (now - cur.startedAt) / 1000);
    else return unknown;
  }
  let todoLeft = 0;
  for (const s of steps) {
    if (s.status !== 'todo') continue;
    const h = hist && hist['step:' + r.title + '/' + s.title];
    const e = typeof s.etaSeconds === 'number' && s.etaSeconds > 0 ? s.etaSeconds : typeof h === 'number' && h > 0 ? h : avg;
    if (e === null) return unknown;
    todoLeft += e;
  }
  const computed = curLeft + todoLeft;
  if (explicit !== null && explicit > 0 && explicit >= computed - 5) return { sec: explicit, source: 'claude', explicit, computed };
  return { sec: computed, source: 'computed', explicit, computed };
}

module.exports = { DIR, findRoot, file, load, save, parseDuration, activeRun, runLeft, logActivity, histGet, histSet };
