'use strict';
// Plan usage: how much of the 5-hour and weekly limits a task uses, and how much similar tasks are expected to use.
// The numbers come from Anthropic's usage endpoint. A child process reads them, so this process never holds the login token.
const path = require('path');
const { spawnSync } = require('child_process');

const FETCH_FILE = path.join(__dirname, 'usage-fetch.js');
const MIN_GAP_MS = 20 * 1000;        // never ask again within this time
const LIMITED_MS = 10 * 60 * 1000;   // after a rate limit (HTTP 429): wait this long
const FAILED_MS = 60 * 1000;         // after any other failure: wait this long
const SIMILAR = 0.3;                 // word overlap (Jaccard) from which two task texts count as similar
const TOP = 5;                       // how many similar tasks an estimate uses
const LOG_MAX = 300;                 // how many finished tasks are remembered
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'all', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'be', 'by', 'or', 'as', 'at', 'new', 'use']);

let fetchImpl = null;   // tests replace the network read with a fixed answer
function setFetchForTests(fn) { fetchImpl = fn; }

function readNow() {
  if (fetchImpl) return fetchImpl();
  const r = spawnSync(process.execPath, [FETCH_FILE], { timeout: 6000, encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(String(r.stdout || '').trim()); } catch { return { ok: false, error: 'no-answer' }; }
}

// The latest usage numbers (fresh if they are older than MIN_GAP_MS). Returns null when they cannot be read right now.
// Only percentages and reset times are kept in state.json.
function current(st, now) {
  const prev = st.usageSnap || null;
  if (prev && !prev.ok && now < (prev.retryAt || 0)) return null;
  if (prev && prev.ok && now - prev.at < MIN_GAP_MS) return prev;
  const j = readNow() || {};
  if (j.ok) {
    st.usageSnap = { ok: true, at: now, fiveHour: j.fiveHour || null, weekly: j.weekly || null, opus: j.opus || null };
    return st.usageSnap;
  }
  st.usageSnap = {
    ok: false, at: now, error: String(j.error || (j.status ? 'http ' + j.status : 'no-answer')).slice(0, 80),
    retryAt: now + (j.status === 429 ? LIMITED_MS : FAILED_MS),
  };
  return null;
}

const family = (m) => (/opus/i.test(m || '') ? 'opus' : /sonnet/i.test(m || '') ? 'sonnet' : /haiku/i.test(m || '') ? 'haiku' : String(m || ''));
const modelOf = (st) => (st.context && st.context.model) || '';
const words = (t) => new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)));
// The task text without its time estimate ("Write the readme ~5m" -> "Write the readme").
const plainText = (t) => String(t.content || '').replace(/\s*~\s*\d+(?:\.\d+)?\s*(?:s|m|h)\w*\s*$/i, '').trim();
const pct = (x) => (x && typeof x.pct === 'number' ? x.pct : null);
const round = (x) => Math.round(x * 10) / 10;

function similarity(a, b) {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  const any = a.size + b.size - both;
  return any ? both / any : 0;
}
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// What a task is expected to use, from finished tasks: the similar ones (same model first, the 5 closest, median),
// else the average of all tasks of that model. null when there is no data at all.
function estimate(st, text, model) {
  const log = (st.usageLog || []).filter((e) => typeof e.weekly === 'number' && typeof e.fiveHour === 'number');
  const fam = family(model);
  const me = words(text);
  const scored = log.map((e) => ({ e, s: similarity(me, words(e.text)) })).filter((x) => x.s >= SIMILAR);
  const same = scored.filter((x) => family(x.e.model) === fam);
  const pool = same.length ? same : scored;
  if (pool.length) {
    const top = pool.sort((a, b) => b.s - a.s || b.e.at - a.e.at).slice(0, TOP).map((x) => x.e);
    return {
      kind: 'similar', n: top.length, model: fam, sameModel: same.length > 0,
      weekly: round(median(top.map((e) => e.weekly))), fiveHour: round(median(top.map((e) => e.fiveHour))),
    };
  }
  const byModel = log.filter((e) => family(e.model) === fam);
  if (byModel.length) {
    return {
      kind: 'average', n: byModel.length, model: fam, sameModel: true,
      weekly: round(mean(byModel.map((e) => e.weekly))), fiveHour: round(mean(byModel.map((e) => e.fiveHour))),
    };
  }
  return null;
}

// A task has just started: remember where the limits stand, and what similar tasks used.
function startTask(st, t, now, cfg) {
  delete t.usageStart;
  delete t.usageEst;
  if (!cfg.usageEstimate && !cfg.usageRecord) return;
  const snap = current(st, now);
  if (!snap) return;
  t.usageStart = { at: now, weekly: pct(snap.weekly), fiveHour: pct(snap.fiveHour) };
  if (cfg.usageEstimate) {
    const est = estimate(st, plainText(t), modelOf(st));
    if (est) t.usageEst = Object.assign({ at: now }, est);
  }
}

// A task has just finished: record how much of each limit it used, for the estimates of later tasks.
function finishTask(st, t, now, cfg) {
  const start = t.usageStart;
  delete t.usageStart;
  delete t.usageEst;
  if (!cfg.usageRecord || !start || typeof start.weekly !== 'number' || typeof start.fiveHour !== 'number') return;
  const snap = current(st, now);
  if (!snap || !snap.weekly || !snap.fiveHour) return;
  const weekly = snap.weekly.pct - start.weekly;
  const fiveHour = snap.fiveHour.pct - start.fiveHour;
  if (weekly < -0.5 || fiveHour < -0.5) return; // a limit reset during the task: the numbers mean nothing
  st.usageLog = st.usageLog || [];
  st.usageLog.push({
    text: plainText(t).slice(0, 200), model: family(modelOf(st)),
    weekly: round(Math.max(0, weekly)), fiveHour: round(Math.max(0, fiveHour)), at: now,
  });
  if (st.usageLog.length > LOG_MAX) st.usageLog.splice(0, st.usageLog.length - LOG_MAX);
}

module.exports = { current, estimate, startTask, finishTask, plainText, family, similarity, median, setFetchForTests, SIMILAR, TOP, LOG_MAX };
