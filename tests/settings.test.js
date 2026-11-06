// Tests for the settings file shared by the Claude plugin and the VS Code extension.
// Run: node tests/settings.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-settings-'));
process.env.AGENT_DASH_HOME = tmp;
const plugin = require('../claude-plugin/scripts/lib/settings');
const ext = require('../vscode-extension/lib/settings');
const fileOf = () => path.join(tmp, '.agent-dashboard', 'settings.json');

try {
  // Defaults: fifteen switches; the screenshots and Output switches are off, the others on, and the two copies of the list agree.
  assert.strictEqual(Object.keys(plugin.DEFAULTS).length, 16);
  assert.strictEqual(plugin.DEFAULTS.showScreenshots, false);
  assert.strictEqual(plugin.DEFAULTS.screenshotsFullscreen, false);
  assert.strictEqual(plugin.DEFAULTS.showOutput, false);
  assert.ok(Object.entries(plugin.DEFAULTS).filter(([k]) => !['showScreenshots', 'screenshotsFullscreen', 'showOutput'].includes(k)).every(([, v]) => v === true));
  assert.deepStrictEqual(ext.DEFAULTS, plugin.DEFAULTS);
  assert.ok(!fs.existsSync(fileOf()));
  assert.deepStrictEqual(plugin.read(), plugin.DEFAULTS);
  console.log('ok - no file: every switch is on, and the plugin and extension agree');

  // update() changes only the keys it gets.
  plugin.update({ localApi: false });
  assert.strictEqual(plugin.read().localApi, false);
  assert.strictEqual(plugin.read().usageEstimate, true);
  plugin.update({ usageRecord: false });
  assert.strictEqual(plugin.read().localApi, false);
  assert.strictEqual(plugin.read().usageRecord, false);
  assert.ok(fs.existsSync(fileOf()), 'the file is written to ~/.agent-dashboard/settings.json');
  console.log('ok - update changes only the keys given');

  // The extension reads and writes the same file.
  ext.update({ githubActions: false });
  assert.strictEqual(plugin.read().githubActions, false);
  assert.strictEqual(ext.read().localApi, false);
  console.log('ok - the extension and the plugin share one file');

  // Unknown keys and values that are not true/false are ignored.
  fs.writeFileSync(fileOf(), JSON.stringify({ localApi: 'no', bogus: true, usageEstimate: false, pluginAutoUpdate: 0 }));
  const got = plugin.read();
  assert.strictEqual(got.localApi, true, 'a text value falls back to the default');
  assert.strictEqual(got.usageEstimate, false);
  assert.strictEqual(got.pluginAutoUpdate, true);
  assert.ok(!('bogus' in got));
  assert.strictEqual(Object.keys(got).length, 16);
  console.log('ok - unknown keys and bad values are ignored');

  // A broken file gives the defaults, not an error.
  fs.writeFileSync(fileOf(), '{ not json');
  assert.deepStrictEqual(plugin.read(), plugin.DEFAULTS);
  assert.deepStrictEqual(ext.read(), ext.DEFAULTS);
  console.log('ok - a broken file gives the defaults');

  // write() keeps only known keys and fills in the rest.
  const w = plugin.write({ usageRecord: false, nope: 1 });
  assert.strictEqual(w.usageRecord, false);
  assert.strictEqual(w.localApi, true);
  assert.ok(!('nope' in w));
  console.log('ok - write keeps known keys and fills in defaults');

  // parseOnOff reads on/off words.
  assert.strictEqual(plugin.parseOnOff('on'), true);
  assert.strictEqual(plugin.parseOnOff('OFF'), false);
  assert.strictEqual(plugin.parseOnOff('yes'), true);
  assert.strictEqual(plugin.parseOnOff('maybe'), null);
  assert.strictEqual(plugin.parseOnOff(undefined), null);
  console.log('ok - on/off words');

  // The command line: settings, settings get, settings set (run against the temp folder, never the real settings).
  const { spawnSync } = require('child_process');
  const dash = path.join(__dirname, '..', 'claude-plugin', 'scripts', 'dash.js');
  const run = (...args) => spawnSync(process.execPath, [dash, ...args], {
    env: Object.assign({}, process.env, { AGENT_DASH_HOME: tmp, AGENT_DASH_ROOT: tmp }), encoding: 'utf8',
  });
  let r = run('settings', 'set', 'pluginAutoUpdate', 'off');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(plugin.read().pluginAutoUpdate, false);
  r = run('settings', 'get', 'pluginAutoUpdate');
  assert.strictEqual(r.stdout.trim(), 'off');
  r = run('settings', 'set', 'nope', 'on');
  assert.notStrictEqual(r.status, 0, 'an unknown key is refused');
  r = run('settings');
  assert.ok(/pluginAutoUpdate: off/.test(r.stdout) && /localApi: on/.test(r.stdout), r.stdout);
  console.log('ok - command line: settings, settings get, settings set');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('all settings tests passed');
