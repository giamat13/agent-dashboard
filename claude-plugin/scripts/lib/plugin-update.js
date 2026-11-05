'use strict';
// Updates the Claude plugin "agent-dashboard" from its marketplace, at most once a day, in the background, while the
// "pluginAutoUpdate" switch is on. The SessionStart hook starts the check. The new version is used after Claude Code restarts,
// so the first session start after an update says so, once.
// The background run is: node plugin-update.js --run
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const settings = require('./settings');

const MARKETPLACE = 'agent-dashboard';
const PLUGIN = 'agent-dashboard@agent-dashboard';
const DAY_MS = 24 * 60 * 60 * 1000;
const TAIL_CHARS = 400;   // the end of a failed command's output, kept for the record

const stateFile = () => path.join(path.dirname(settings.file()), 'plugin-update.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { return {}; }
}

function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2) + '\n');
  } catch { /* no state file: the next session start tries again */ }
}

// The installed version of the plugin, from the text of "claude plugin list". null when the plugin is not listed.
function versionFrom(listText) {
  const lines = String(listText || '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().replace(/^❯\s*/, '') === PLUGIN);
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('❯')) break;   // the next plugin in the list
    const m = /^Version:\s*(\S+)/.exec(t);
    if (m) return m[1];
  }
  return null;
}

// Runs one shell command. Returns { status, out }.
function runShell(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 180000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

// The update: the marketplace, then the plugin, and the versions before and after. A new version is kept as a notice
// for the next session start. run and now can be replaced in tests.
function runUpdate(run = runShell, now = Date.now()) {
  const before = versionFrom(run('claude plugin list').out);
  const mk = run('claude plugin marketplace update ' + MARKETPLACE);
  const up = run('claude plugin update ' + PLUGIN);
  const after = versionFrom(run('claude plugin list').out);
  const ok = up.status === 0;
  const s = Object.assign(readState(), {
    checkedAt: now, before, after, ok,
    error: ok ? null : String(up.out || mk.out || 'failed').slice(-TAIL_CHARS),
  });
  if (before && after && after !== before) s.notice = { from: before, to: after, at: now };
  writeState(s);
  return s;
}

// Starts "node plugin-update.js --run" in the background, so the session does not wait for it.
function startBackground() {
  try {
    const child = spawn(process.execPath, [__filename, '--run'], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: Object.assign({}, process.env, { AGENT_DASH_PLUGIN_UPDATE: '1' }),
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* cannot start: the next check is a day later */ }
}

// Called from the SessionStart hook. Starts the background check when one is due (at most one a day), and returns the
// notice for Claude, once, after an update (empty string when there is nothing to say).
function sessionStart({ now = Date.now(), start = startBackground } = {}) {
  if (process.env.AGENT_DASH_PLUGIN_UPDATE) return '';   // this is the background check itself
  if (settings.read().pluginAutoUpdate === false) return '';
  const s = readState();
  const next = Object.assign({}, s);
  let notice = '';
  if (s.notice && s.notice.to) {
    notice = 'Agent Dashboard was updated from ' + s.notice.from + ' to ' + s.notice.to + '. Restart Claude Code to use the new version, and tell the user this in one short sentence.';
    next.notice = null;
  }
  const due = !s.checkedAt || now - s.checkedAt >= DAY_MS;
  if (due) next.checkedAt = now;   // written before the check starts, so two sessions do not both start one
  if (due || notice) writeState(next);
  if (due) start();
  return notice;
}

module.exports = { PLUGIN, MARKETPLACE, DAY_MS, stateFile, readState, versionFrom, runUpdate, startBackground, sessionStart };

if (require.main === module && process.argv.includes('--run')) {
  try { runUpdate(); } catch { /* the state file keeps the last result */ }
}
