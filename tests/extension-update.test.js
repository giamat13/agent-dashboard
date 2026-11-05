// Tests for the extension's update check (vscode-extension/extension.js, checkExtensionUpdate). The VS Code API and the
// network are replaced by fakes, so this runs with plain node. Run: node tests/extension-update.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.join(__dirname, '..', 'vscode-extension');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const [maj, min, pat] = VERSION.split('.').map(Number);
const NEWER = [maj, min, pat + 1].join('.');   // a release newer than the running version
const ASSET = 'agent-dashboard-' + NEWER + '.vsix';
const BASE = 'https://github.com/GIAMAT13/agent-dashboard/releases/download/v' + NEWER + '/';
const RELEASE = {
  tag_name: 'v' + NEWER,
  assets: [
    { name: ASSET, browser_download_url: BASE + ASSET },
    { name: ASSET + '.sha256', browser_download_url: BASE + ASSET + '.sha256' },
  ],
};

// A settings folder of its own, and no Claude login, so the usage check stays offline.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-ext-'));
process.env.AGENT_DASH_HOME = home;
os.homedir = () => home;
const settingsFile = path.join(home, '.agent-dashboard', 'settings.json');
const setSettings = (obj) => {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(obj));
};

// Fake VS Code API: what the extension calls, and what it reports back.
const executed = [], messages = [], store = new Map(), commands = new Map();
const ctx = {
  subscriptions: [],
  globalState: {
    get: (k, d) => (store.has(k) ? store.get(k) : d),
    update: (k, v) => { store.set(k, v); return Promise.resolve(); },
  },
};
const disposable = () => ({ dispose() {} });
const vscode = {
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }), joinPath: () => ({}) },
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { Beside: 2 },
  ConfigurationTarget: { Global: 1 },
  RelativePattern: function () {},
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (k, d) => d, inspect: () => ({}), update: () => Promise.resolve() }),
    onDidChangeConfiguration: disposable,
    onDidChangeWorkspaceFolders: disposable,
  },
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    registerWebviewViewProvider: disposable,
    showInformationMessage: (text) => { messages.push(['info', text]); return Promise.resolve(undefined); },
    showWarningMessage: (text) => { messages.push(['warn', text]); return Promise.resolve(undefined); },
  },
  commands: {
    registerCommand: (id, fn) => { commands.set(id, fn); return disposable(); },
    executeCommand: (id, arg) => { executed.push([id, arg && arg.fsPath]); return Promise.resolve(); },
  },
};

// Fake network (lib/http.js): the release list, the checksum file and the .vsix itself.
const net = { calls: [], notFound: false, sumOverride: null, release: RELEASE, bytes: Buffer.from('vsix bytes') };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fakeHttp = {
  async getJson() {
    net.calls.push('json');
    if (net.notFound) { const e = new Error('http 404'); e.status = 404; throw e; }
    return net.release;
  },
  async getText() {
    net.calls.push('text');
    return (net.sumOverride || sha(net.bytes)) + '  ' + ASSET + '\n';
  },
  async download(url, file) {
    net.calls.push('download');
    fs.writeFileSync(file, net.bytes);
    return file;
  },
};

// Load extension.js with the fakes in place of 'vscode' and of its http helper.
const extFile = path.join(ROOT, 'extension.js');
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'vscode') return vscode;
  if (request === './lib/http' && parent && parent.filename.endsWith(path.join('vscode-extension', 'extension.js'))) return fakeHttp;
  return origLoad.apply(this, arguments);
};
const ext = require(extFile);

// The first automatic check is set with setTimeout(…, 20000). It is kept here, so the test can run it on purpose.
const autoChecks = [];
const realSetTimeout = global.setTimeout;
global.setTimeout = function (fn, ms) {
  if (ms === 20000) { autoChecks.push(fn); return {}; }
  return realSetTimeout.apply(this, arguments);
};
try { ext.activate(ctx); } finally { global.setTimeout = realSetTimeout; }

const runCommand = () => commands.get('agentDashboard.checkUpdates')();
const installed = path.join(os.tmpdir(), ASSET);
const lastCheck = () => store.get('agentDashboard.update');
const lastMessage = () => messages[messages.length - 1];
const reset = () => {
  net.calls = []; net.notFound = false; net.sumOverride = null; net.release = RELEASE;
  executed.length = 0; messages.length = 0;
};

async function main() {
  // 1. The command: a newer release is downloaded, checked, installed, and the user is offered a reload.
  reset();
  await runCommand();
  assert.deepStrictEqual(net.calls, ['json', 'download', 'text']);
  assert.deepStrictEqual(executed, [['workbench.extensions.installExtension', installed]]);
  assert.ok(!fs.existsSync(installed), 'the download is removed after the install');
  assert.strictEqual(lastMessage()[1], 'Agent Dashboard ' + NEWER + ' is installed. Reload the window to use it.');
  assert.strictEqual(lastCheck().reason, 'newer');
  console.log('ok - a newer release is downloaded, checked and installed');

  // 2. A download that does not match its checksum is not installed, and the user is told.
  reset(); net.sumOverride = 'f'.repeat(64);
  await runCommand();
  assert.deepStrictEqual(executed, []);
  assert.ok(!fs.existsSync(installed), 'the bad download is removed');
  assert.strictEqual(lastMessage()[0], 'warn');
  assert.match(lastMessage()[1], /checksum/);
  assert.strictEqual(lastCheck().reason, 'failed');
  console.log('ok - a download that does not match its checksum is not installed');

  // 3. No release published yet (404): reported as a state, not as an error.
  reset(); net.notFound = true;
  await runCommand();
  assert.deepStrictEqual(net.calls, ['json']);
  assert.strictEqual(lastCheck().reason, 'no-release');
  assert.match(lastMessage()[1], /no release/);
  console.log('ok - no release yet is reported, not treated as an error');

  // 4. The same version: nothing to install. A newer release without its files: said, not installed.
  reset(); net.release = { tag_name: 'v' + VERSION, assets: [] };
  await runCommand();
  assert.deepStrictEqual(net.calls, ['json']);
  assert.strictEqual(lastMessage()[1], 'Agent Dashboard ' + VERSION + ' is the newest version.');
  reset(); net.release = { tag_name: 'v' + NEWER, assets: [] };
  await runCommand();
  assert.deepStrictEqual(net.calls, ['json']);
  assert.match(lastMessage()[1], /no-assets/);
  console.log('ok - the same version and a release without files are not installed');

  // 5. The automatic check follows the switch, and is not repeated within 50 minutes.
  const auto = autoChecks[0];
  assert.strictEqual(typeof auto, 'function', 'the first automatic check is scheduled');
  reset(); store.delete('agentDashboard.update'); setSettings({ extensionAutoUpdate: false });
  await auto();
  assert.deepStrictEqual(net.calls, [], 'switch off: no automatic check');
  reset(); setSettings({ extensionAutoUpdate: true });
  await auto();
  assert.deepStrictEqual(net.calls, ['json', 'download', 'text'], 'switch on: the automatic check installs the newer release');
  reset();
  await auto();
  assert.deepStrictEqual(net.calls, [], 'a check made lately is not repeated');
  console.log('ok - the automatic check follows the switch and waits between checks');

  // 6. The command checks even when the switch is off.
  reset(); store.delete('agentDashboard.update'); setSettings({ extensionAutoUpdate: false });
  await runCommand();
  assert.deepStrictEqual(net.calls, ['json', 'download', 'text']);
  console.log('ok - the command checks even when the switch is off');

  for (const s of ctx.subscriptions) if (s && typeof s.dispose === 'function') s.dispose();
  Module._load = origLoad;
  fs.rmSync(home, { recursive: true, force: true });
  console.log('all extension update tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
