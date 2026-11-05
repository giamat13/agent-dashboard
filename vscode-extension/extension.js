'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const REL = ['.agent-dashboard', 'state.json'];
let ctx, status, panel;
const views = new Set();
let lastKey = '';

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
  if (!best) return { state: null, key: 'none' };
  try {
    return { state: JSON.parse(fs.readFileSync(best.f, 'utf8')), key: best.f + best.m };
  } catch {
    return { state: null, key: 'bad' };
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

function broadcast(force) {
  refreshUsage();
  const { state, key } = readState();
  updateStatusBar(state);
  const ukey = key + '|' + (usage ? usage.fetchedAt || usage.error : '');
  if (!force && ukey === lastKey) return;
  lastKey = ukey;
  for (const w of [...views, panel && panel.webview].filter(Boolean)) {
    w.postMessage({ type: 'state', state, cfg: cfg(), usage });
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
  broadcast(true);
}

function deactivate() {}

module.exports = { activate, deactivate };
