'use strict';
// Dashboard settings, shared with the VS Code extension: ~/.agent-dashboard/settings.json (one file for every project).
// Every key is on (true) or off (false). Keep DEFAULTS in sync with vscode-extension/lib/settings.js (tests/settings.test.js checks it).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  usageEstimate: true,        // planned share on the usage limit bars
  usageRecord: true,          // remember how much usage each finished task used
  githubActions: true,        // GitHub Actions card
  localApi: true,             // read-only local API for other tools (127.0.0.1)
  extensionAutoUpdate: true,  // the VS Code extension updates itself from GitHub Releases
  pluginAutoUpdate: true,     // the Claude plugin updates itself, at most once a day
  showScreenshots: false,     // show the PNG/JPG files Claude reads (copies in .agent-dashboard/shots); off by default
  screenshotsFullscreen: false, // a click on a screenshot opens it over the whole dashboard; off by default
  showActivity: true,         // the Activity card
  showTasks: true,            // the Agent tasks card
  showJobs: true,             // the Parallel jobs card
  showContext: true,          // the Agent memory card
  showUsage: true,            // the Claude usage limits card
  showProviders: true,        // the Codex and Copilot limits card
  showHistory: true,          // the Run history card
  showOutput: false,          // the Output card (the last lines a build or test printed); off by default
};
const KEYS = Object.keys(DEFAULTS);

const home = () => process.env.AGENT_DASH_HOME || os.homedir();
const file = () => path.join(home(), '.agent-dashboard', 'settings.json');

// Keeps only the known keys that hold true or false.
function pick(obj) {
  const out = {};
  if (obj && typeof obj === 'object') for (const k of KEYS) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  return out;
}

// All keys: the saved value, or the default when the file is missing, broken or does not have the key.
function read() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* no file or broken file: defaults */ }
  return Object.assign({}, DEFAULTS, pick(raw));
}

function write(obj) {
  const f = file();
  const out = Object.assign({}, DEFAULTS, pick(obj));
  const json = JSON.stringify(out, null, 2) + '\n';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, json);
  try { fs.renameSync(tmp, f); } catch { fs.writeFileSync(f, json); try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  return out;
}

// Changes only the keys given. The others keep their saved values.
function update(patch) {
  return write(Object.assign(read(), pick(patch)));
}

// "on" / "off" (also true / false, yes / no, 1 / 0) become a boolean. Anything else is null.
function parseOnOff(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (['on', 'true', 'yes', '1'].includes(s)) return true;
  if (['off', 'false', 'no', '0'].includes(s)) return false;
  return null;
}

module.exports = { DEFAULTS, KEYS, file, read, write, update, pick, parseOnOff };
