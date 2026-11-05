'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const settingsLib = require('./lib/settings');
const apiLib = require('./lib/api');
const ghLib = require('./lib/gh');
const http = require('./lib/http');
const updater = require('./lib/updater');
const os = require('os');
const { execFile } = require('child_process');
const { version: VERSION } = require('./package.json');

const REL = ['.agent-dashboard', 'state.json'];
let ctx, status, panel;
const views = new Set();
let lastKey = '';
let api = null, apiKey = '';

function stateFiles() {
  return (vscode.workspace.workspaceFolders || []).map((f) => path.join(f.uri.fsPath, ...REL));
}

function readState() {
  let best = null;
  for (const f of stateFiles()) {
    try {
      const m = fs.statSync(f).mtimeMs;
      if (!best || m > best.m) best = { f, m };
    } catch { /* no file */ }
  }
  // The folder is the one whose state file changed last (or the first folder open, when there is no state yet).
  const first = (vscode.workspace.workspaceFolders || [])[0];
  if (!best) return { state: null, key: 'none', folder: first ? first.uri.fsPath : null };
  const folder = path.dirname(path.dirname(best.f));
  try {
    return { state: JSON.parse(fs.readFileSync(best.f, 'utf8')), key: best.f + best.m, folder };
  } catch {
    return { state: null, key: 'bad', folder };
  }
}

function cfg() {
  return { staleMinutes: vscode.workspace.getConfiguration('agentDashboard').get('staleMinutes', 3) };
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 90) return sec + ' s';
  if (sec < 3600) return Math.round(sec / 60) + ' min';
  return Math.floor(sec / 3600) + ' h ' + Math.round((sec % 3600) / 60) + ' min';
}

function updateStatusBar(state) {
  const run = state && [...state.runs].reverse().find((r) => r.status === 'running');
  if (!run) {
    status.text = '$(graph) Claude';
    status.tooltip = 'Claude Dashboard: no active run';
    return;
  }
  const done = run.steps.filter((s) => s.status === 'done').length;
  const step = run.steps.find((s) => s.status === 'doing');
  let eta = '';
  if (step && step.etaSetAt) eta = ' · ~' + fmt((step.etaSetAt + step.etaSeconds * 1000 - Date.now()) / 1000);
  status.text = `$(sync~spin) ${run.title} · ${done}/${run.steps.length || '?'}${eta}`;
  status.tooltip = run.now || run.plain || run.title;
}

// Claude plan usage (5-hour and weekly limits), read from Anthropic with the user's own Claude Code login.
let usage = null, usageAt = 0, usageBusy = false, usageFailUntil = 0;
const USAGE_EVERY_MS = 90 * 1000;

function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.claude', '.credentials.json'), 'utf8'));
    return j.claudeAiOauth && j.claudeAiOauth.accessToken;
  } catch { return null; }
}

function refreshUsage() {
  const now = Date.now();
  if (usageBusy || now - usageAt < USAGE_EVERY_MS || now < usageFailUntil) return;
  const token = readToken();
  if (!token) { usage = { error: 'not-logged-in' }; usageAt = now; return; }
  usageBusy = true;
  const req = require('https').request('https://api.anthropic.com/api/oauth/usage', {
    method: 'GET', timeout: 10000,
    headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'agent-dashboard' },
  }, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      usageBusy = false; usageAt = Date.now();
      try {
        if (res.statusCode !== 200) throw new Error('http ' + res.statusCode);
        const j = JSON.parse(body);
        const pick = (x) => (x && typeof x.utilization === 'number' ? { pct: Math.min(100, Math.max(0, x.utilization)), resetsAt: x.resets_at ? Date.parse(x.resets_at) : null } : null);
        usage = { fiveHour: pick(j.five_hour), weekly: pick(j.seven_day), opus: pick(j.seven_day_opus), fetchedAt: Date.now() };
      } catch (e) {
        if (res.statusCode === 429) usageFailUntil = Date.now() + 10 * 60 * 1000;
        if (!usage || usage.error) usage = { error: String(e.message || e) };
      }
      broadcast(true);
    });
  });
  const fail = (m) => { usageBusy = false; usageAt = Date.now(); if (!usage || usage.error) usage = { error: m }; broadcast(true); };
  req.on('timeout', () => { req.destroy(); });
  req.on('error', (e) => fail(String(e.message || e)));
  req.end();
}

// The local API (lib/api.js) runs while the "localApi" switch is on and a folder is open. It follows the switch and the folders.
function syncApi(want) {
  const dirs = want ? (vscode.workspace.workspaceFolders || []).map((f) => path.join(f.uri.fsPath, '.agent-dashboard')) : [];
  const key = dirs.join('|');
  if (key === apiKey) return;
  apiKey = key;
  const old = api;
  api = null;
  Promise.resolve(old && old.close()).then(() => {
    if (!dirs.length || apiKey !== key) return null;
    return apiLib.start({ version: VERSION, infoDirs: dirs, getState: () => readState().state, getUsage: () => usage, getGithub: () => ghView(readState().state, settingsLib.read()) });
  }).then((a) => {
    if (!a) return;
    if (apiKey === key) api = a; else a.close();
  }).catch(() => { /* the port is busy or the folder cannot be written: the dashboard works without the API */ });
}

// GitHub Actions card: the runs of the folder's repository, read with the GitHub CLI (lib/gh.js). Read about once a minute,
// every 15 seconds while a run goes on, and 10 minutes after an error. The estimates are worked out again on every update.
const GH_EVERY_MS = 60 * 1000, GH_FAST_MS = 15 * 1000, GH_RETRY_MS = 10 * 60 * 1000;
let ghRaw = null;                 // { at, folder, repo, runs } or { at, folder, repo, error } from the last read
let ghFolder = null, ghBusy = false, ghNextAt = 0;

// What the card shows: the last read, with the estimates of the current state. { error: 'off' } when the switch is off.
function ghView(state, settings) {
  if (settings.githubActions === false) return { error: 'off', repo: null, running: [], recent: [], pages: null, at: Date.now() };
  if (!ghRaw) return null;
  const base = { repo: ghRaw.repo || null, error: ghRaw.error || null, at: ghRaw.at };
  if (ghRaw.error) return Object.assign({ running: [], recent: [], pages: null }, base);
  return Object.assign(ghLib.summarize(ghRaw.runs, { now: Date.now(), ciEta: (state && state.ciEta) || {} }), base);
}

function refreshGithub(folder, settings) {
  if (settings.githubActions === false) { ghRaw = null; ghNextAt = 0; return; }
  if (folder !== ghFolder) { ghFolder = folder; ghRaw = null; ghNextAt = 0; }
  if (!folder || ghBusy || Date.now() < ghNextAt) return;
  ghBusy = true;
  const asked = folder;
  ghLib.fetchRuns(folder).then(
    (res) => ({ at: Date.now(), folder: asked, repo: res.repo || null, runs: res.runs, error: res.error }),
    () => ({ at: Date.now(), folder: asked, repo: null, error: 'failed' })
  ).then((raw) => {
    if (asked === ghFolder) ghRaw = raw;
    const running = !raw.error && raw.runs.some((r) => ghLib.RUNNING.includes(r.status));
    ghNextAt = Date.now() + (raw.error ? GH_RETRY_MS : running ? GH_FAST_MS : GH_EVERY_MS);
    ghBusy = false;
    broadcast(true);
  });
}

function broadcast(force) {
  refreshUsage();
  const { state, key, folder } = readState();
  updateStatusBar(state);
  const settings = settingsLib.read();   // the file can change from the Claude side too (dash.js settings set ...)
  syncApi(settings.localApi !== false);
  refreshGithub(folder, settings);
  const gh = ghView(state, settings);
  const ukey = key + '|' + (usage ? usage.fetchedAt || usage.error : '') + '|' + JSON.stringify(settings) + '|' + (ghRaw ? ghRaw.at : '');
  if (!force && ukey === lastKey) return;
  lastKey = ukey;
  for (const w of [...views, panel && panel.webview].filter(Boolean)) {
    w.postMessage({ type: 'state', state, cfg: cfg(), usage, settings, gh });
  }
}

function html(webview) {
  const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', f));
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('main.css')}"></head>
<body><div id="app">Loading…</div><script nonce="${nonce}" src="${uri('main.js')}"></script></body></html>`;
}

function wire(webview) {
  webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] };
  webview.html = html(webview);
  webview.onDidReceiveMessage((m) => {
    if (m.type === 'ready') broadcast(true);
    if (m.type === 'openPanel') openPanel();
    if (m.type === 'setSettings') { settingsLib.update(m.settings); broadcast(true); }
  });
}

// While the dashboard panel is the ACTIVE editor, the window title shows only the project name. With any other editor active the title is the user's own, as usual.
const TITLE_ONLY_PROJECT = '${rootName}';
async function applyProjectOnlyTitle() {
  try {
    const cfg = vscode.workspace.getConfiguration('window');
    const insp = cfg.inspect('title');
    if (ctx.globalState.get('agentDashboard.prevTitleSaved') !== true) {
      await ctx.globalState.update('agentDashboard.prevTitle', insp.globalValue === undefined ? null : insp.globalValue);
      await ctx.globalState.update('agentDashboard.prevTitleSaved', true);
    }
    await cfg.update('title', TITLE_ONLY_PROJECT, vscode.ConfigurationTarget.Global);
  } catch { /* ignore */ }
}
async function restoreTitle() {
  try {
    if (ctx.globalState.get('agentDashboard.prevTitleSaved') !== true) return;
    const prev = ctx.globalState.get('agentDashboard.prevTitle');
    await vscode.workspace.getConfiguration('window').update('title', prev === null ? undefined : prev, vscode.ConfigurationTarget.Global);
    await ctx.globalState.update('agentDashboard.prevTitleSaved', false);
  } catch { /* ignore */ }
}

function openPanel() {
  if (panel) return panel.reveal();
  panel = vscode.window.createWebviewPanel('agentDashboard.panel', 'Claude Dashboard', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  wire(panel.webview);
  const syncTitle = () => { if (panel && panel.active) applyProjectOnlyTitle(); else restoreTitle(); };
  panel.onDidChangeViewState(syncTitle);
  syncTitle();
  panel.onDidDispose(() => { panel = undefined; restoreTitle(); });
}

function clearHistory() {
  for (const f of stateFiles()) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      s.runs = [];
      fs.writeFileSync(f, JSON.stringify(s, null, 1));
    } catch { /* ignore */ }
  }
  broadcast(true);
}

// Extension updates: the newest GitHub release of this extension is installed when it is newer than the running version.
// The automatic check runs a little after start and then every hour, while the "extensionAutoUpdate" switch is on, and it is
// not repeated within 50 minutes of the last check. "Agent Dashboard: Check for updates" always checks and always says what it found.
const UPDATE_FIRST_MS = 20 * 1000, UPDATE_EVERY_MS = 60 * 60 * 1000, UPDATE_RECENT_MS = 50 * 60 * 1000;
const UPDATE_KEY = 'agentDashboard.update';
let updateBusy = false;

function rememberUpdate(v) {
  try { return Promise.resolve(ctx.globalState.update(UPDATE_KEY, v)).catch(() => {}); } catch { return Promise.resolve(); }
}

// Installs the .vsix with the VS Code command. When VS Code refuses the file, the "code" command line does it.
function installVsix(file) {
  return Promise.resolve()
    .then(() => vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file)))
    .catch(() => new Promise((resolve, reject) => {
      const arg = process.platform === 'win32' ? '"' + file + '"' : file;
      execFile('code', ['--install-extension', arg, '--force'], { shell: process.platform === 'win32', windowsHide: true, timeout: 120000 },
        (err) => (err ? reject(err) : resolve()));
    }));
}

// Downloads the release, checks its SHA-256 against the .sha256 file, and installs it. The download is removed afterwards.
async function installRelease(p) {
  const file = path.join(os.tmpdir(), updater.NAME + '-' + p.version + '.vsix');
  try {
    await http.download(p.vsix, file);
    const want = updater.parseSha256(await http.getText(p.sha256));
    if (!want || want !== (await updater.fileSha256(file))) throw new Error('the download does not match its checksum');
    await installVsix(file);
  } finally {
    try { fs.unlinkSync(file); } catch { /* not there */ }
  }
}

async function checkExtensionUpdate(manual) {
  if (updateBusy) return;
  const last = ctx.globalState.get(UPDATE_KEY);
  if (!manual && (settingsLib.read().extensionAutoUpdate === false || (last && Date.now() - last.checkedAt < UPDATE_RECENT_MS))) return;
  updateBusy = true;
  let p = null;
  try {
    let release;
    try {
      release = await http.getJson(updater.RELEASES_URL);
    } catch (e) {
      if (e.status !== 404) throw e;
      await rememberUpdate({ checkedAt: Date.now(), latest: null, reason: 'no-release' });
      if (manual) vscode.window.showInformationMessage('Agent Dashboard: no release is published yet.');
      return;
    }
    p = updater.plan(release, VERSION);
    await rememberUpdate({ checkedAt: Date.now(), latest: p.version || null, reason: p.reason || (p.action === 'install' ? 'newer' : 'current') });
    if (p.action !== 'install') {
      if (manual) {
        vscode.window.showInformationMessage(p.reason
          ? 'Agent Dashboard: release ' + p.version + ' cannot be installed (' + p.reason + ').'
          : 'Agent Dashboard ' + VERSION + ' is the newest version.');
      }
      return;
    }
    await installRelease(p);
  } catch (e) {
    await rememberUpdate({ checkedAt: Date.now(), latest: null, reason: 'failed' });
    if (manual) vscode.window.showWarningMessage('Agent Dashboard: the update check failed (' + (e.message || e) + ').');
    return;
  } finally {
    updateBusy = false;
  }
  vscode.window.showInformationMessage('Agent Dashboard ' + p.version + ' is installed. Reload the window to use it.', 'Reload Window')
    .then((pick) => { if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow'); });
}

function activate(context) {
  ctx = context;
  if (!panel) restoreTitle();   // recover if the window was closed while the panel was open
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'agentDashboard.open';
  status.show();

  context.subscriptions.push(
    status,
    vscode.window.registerWebviewViewProvider('agentDashboard.view', {
      resolveWebviewView(view) {
        views.add(view.webview);
        wire(view.webview);
        view.onDidDispose(() => views.delete(view.webview));
      },
    }),
    vscode.commands.registerCommand('agentDashboard.open', openPanel),
    vscode.commands.registerCommand('agentDashboard.clear', clearHistory),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('agentDashboard') && broadcast(true)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { setupWatchers(); broadcast(true); }),
  );

  let watchers = [];
  function setupWatchers() {
    watchers.forEach((w) => w.dispose());
    watchers = (vscode.workspace.workspaceFolders || []).map((f) => {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(f, '.agent-dashboard/state.json'));
      w.onDidChange(() => broadcast());
      w.onDidCreate(() => broadcast());
      w.onDidDelete(() => broadcast(true));
      return w;
    });
  }
  setupWatchers();
  context.subscriptions.push({ dispose: () => watchers.forEach((w) => w.dispose()) });

  // גיבוי למקרה שהווטצ'ר מפספס, וגם לעדכון ספירה לאחור בשורת הסטטוס.
  const timer = setInterval(() => broadcast(), 2000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Extension updates (see checkExtensionUpdate): an automatic check a little after start, then hourly.
  const updateFirst = setTimeout(() => checkExtensionUpdate(false), UPDATE_FIRST_MS);
  const updateEvery = setInterval(() => checkExtensionUpdate(false), UPDATE_EVERY_MS);
  context.subscriptions.push(
    { dispose: () => { clearTimeout(updateFirst); clearInterval(updateEvery); } },
    vscode.commands.registerCommand('agentDashboard.checkUpdates', () => checkExtensionUpdate(true)),
  );
  broadcast(true);
}

function deactivate() {
  return api ? api.close() : undefined;
}

module.exports = { activate, deactivate };
