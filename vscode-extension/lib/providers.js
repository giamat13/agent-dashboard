'use strict';
// Usage limits of the other coding agents, shown next to Claude's limits: Codex and GitHub Copilot.
// Only the limits of a paid (Pro) plan are read. A limit that exists only on the free plan is never returned,
// so a free plan shows no meter at all. Nothing here reads or prints a login token.
// - Codex: the newest rate limits that Codex wrote into its own session files (CODEX_HOME, default ~/.codex). Read offline.
// - Copilot: the premium-request quota of the GitHub CLI login (gh api copilot_internal/user). Read at most every 5 minutes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Codex window length in minutes -> key. A monthly window (43200) is the free plan's only limit: it is left out.
const WINDOW_KEYS = { 300: 'fiveHour', 10080: 'weekly' };
const TAIL_BYTES = 512 * 1024;   // read the end of each session file only
const MAX_FILES = 8;             // newest session files to look at
const COPILOT_EVERY_MS = 5 * 60 * 1000;
const GH_TIMEOUT_MS = 10 * 1000;

const clampPct = (n) => Math.min(100, Math.max(0, n));

function codexDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// Session files, newest first. Their names start with the date and time: rollout-2026-11-03T19-07-33-<id>.jsonl
function rolloutFiles(dir) {
  const found = [];
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) found.push(p);
    }
  };
  for (const sub of ['sessions', 'archived_sessions']) walk(path.join(dir, sub), 0);
  const name = (p) => path.basename(p);
  return found.sort((a, b) => (name(a) < name(b) ? 1 : name(a) > name(b) ? -1 : 0)).slice(0, MAX_FILES);
}

function tailLines(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8').split('\n');
  } catch {
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// The rate_limits object of one line of a session file, or null. Codex nests it under the event payload.
function rateLimitsOf(line) {
  if (!line.includes('"rate_limits"')) return null;
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const find = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 4) return null;
    if (x.rate_limits && typeof x.rate_limits === 'object') return x.rate_limits;
    for (const k of Object.keys(x)) {
      const r = find(x[k], depth + 1);
      if (r) return r;
    }
    return null;
  };
  return find(obj, 0);
}

// Keeps the windows a paid plan has. Anything else (the monthly window of the free plan) is dropped.
function pickCodex(rl) {
  const out = { plan: rl.plan_type || null, fiveHour: null, weekly: null };
  for (const w of [rl.primary, rl.secondary]) {
    const key = w && typeof w === 'object' ? WINDOW_KEYS[w.window_minutes] : undefined;
    if (!key || typeof w.used_percent !== 'number') continue;
    out[key] = { pct: clampPct(w.used_percent), resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : null };
  }
  return out;
}

// The newest reading decides the plan. Returns null when there are no Codex sessions or no reading at all.
function codexUsage(opts) {
  const dir = (opts && opts.dir) || codexDir();
  for (const file of rolloutFiles(dir)) {
    const lines = tailLines(file);
    for (let i = lines.length - 1; i >= 0; i--) {
      const rl = rateLimitsOf(lines[i]);
      if (rl) return Object.assign({ at: Date.now() }, pickCodex(rl));
    }
  }
  return null;
}

// Copilot: the premium-request quota is the Pro allowance. Chat and completions are unlimited on Pro and limited on Free,
// so they are never shown.
function pickCopilot(j) {
  const snap = j && j.quota_snapshots && j.quota_snapshots.premium_interactions;
  if (!snap || snap.unlimited || !(snap.entitlement > 0)) return null;   // free plan: no premium allowance
  let pct;
  if (typeof snap.remaining === 'number') pct = ((snap.entitlement - snap.remaining) / snap.entitlement) * 100;
  else if (typeof snap.percent_remaining === 'number') pct = 100 - snap.percent_remaining;
  else return null;
  const reset = j.quota_reset_date ? Date.parse(j.quota_reset_date + 'T00:00:00Z') : NaN;
  return { pct: clampPct(pct), resetsAt: Number.isNaN(reset) ? null : reset };
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: GH_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

// Resolves to { at, plan, premium: { pct, resetsAt } | null } or { at, error }.
function copilotUsage(opts) {
  const run = (opts && opts.run) || runGh;
  const now = (opts && opts.now) || Date.now();
  return Promise.resolve().then(() => run(['api', 'copilot_internal/user'])).then((out) => {
    let j;
    try { j = JSON.parse(out); } catch { return { at: now, error: 'bad-response' }; }
    return { at: now, plan: (j && j.copilot_plan) || null, premium: pickCopilot(j) };
  }, (e) => ({ at: now, error: e && e.code === 'ENOENT' ? 'no-gh' : 'gh-failed' }));
}

// Reads both agents. Codex is read every time (a local file). Copilot is read again only after 5 minutes.
function readAll(opts) {
  const now = (opts && opts.now) || Date.now();
  const prev = (opts && opts.previous) || {};
  const copilot = prev.copilot && now - prev.copilot.at < COPILOT_EVERY_MS
    ? Promise.resolve(prev.copilot)
    : copilotUsage(opts);
  let codex = null;
  try { codex = codexUsage(opts); } catch { codex = null; }
  return copilot.then((cop) => ({ at: now, codex, copilot: cop }));
}

module.exports = { WINDOW_KEYS, COPILOT_EVERY_MS, rolloutFiles, rateLimitsOf, pickCodex, codexUsage, pickCopilot, copilotUsage, readAll };
