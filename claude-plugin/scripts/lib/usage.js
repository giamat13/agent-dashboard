'use strict';
// Plan usage: how much of the 5-hour and weekly limits is used right now (the usage card and dash.js usage).
// The numbers come from Anthropic's usage endpoint. A child process reads them, so this process never holds the login token.
const path = require('path');
const { spawnSync } = require('child_process');

const FETCH_FILE = path.join(__dirname, 'usage-fetch.js');
const MIN_GAP_MS = 20 * 1000;        // never ask again within this time
const LIMITED_MS = 10 * 60 * 1000;   // after a rate limit (HTTP 429): wait this long
const FAILED_MS = 60 * 1000;         // after any other failure: wait this long

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

module.exports = { current, setFetchForTests };
