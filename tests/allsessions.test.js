// Fixture tests for the "All sessions" view in media/main.js (view and tabsHtml).
// Run: node tests/allsessions.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'vscode-extension', 'media', 'main.js'), 'utf8');

// The webview script runs inside one IIFE, so each helper is cut out by its name and run as it is written there.
function grab(name) {
  const at = src.indexOf('  function ' + name + '(');
  assert.ok(at >= 0, name + ' not found in media/main.js');
  return src.slice(at, src.indexOf('\n  }\n', at) + '\n  }\n'.length);
}
const allConst = /^\s*const ALL = .*;$/m.exec(src);
assert.ok(allConst, 'const ALL not found in media/main.js');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = () => '12:00:00';

// view() and tabsHtml() as the dashboard has them, with the current selection (sel) passed in.
function web(sel) {
  const agentInfo = /^  const AGENT_INFO = \{[\s\S]*?\n  \};$/m.exec(src);
  assert.ok(agentInfo, 'AGENT_INFO not found in media/main.js');
  const body = [allConst[0].trim(), agentInfo[0], grab('agentIcon'), grab('view'), grab('tabsHtml'), 'return { view: view, tabsHtml: tabsHtml };'].join('\n');
  return new Function('sel', 'esc', 'hhmm', body)(sel, esc, hhmm);
}

const NOW = Date.now();
const a = { id: 'sa', title: 'Refactor', lastSeen: NOW, todos: [{ id: '1', content: 'Split file', status: 'in_progress' }], goal: { text: 'Clean up' }, context: { percent: 40 } };
const b = { id: 'sb', title: 'Docs', lastSeen: NOW - 1000, todos: [{ id: '1', content: 'Write readme', status: 'completed' }, { id: '2', content: 'Check links', status: 'pending' }] };
const S = {
  session: 'sa',
  todos: a.todos,
  runs: [
    { id: 'r1', title: 'Build', status: 'running', session: 'sa', steps: [] },
    { id: 'r2', title: 'Lint', status: 'done', session: 'sb', steps: [] },
    { id: 'r3', title: 'Old run', status: 'done', steps: [] },
  ],
};
const list = [a, b]; // newest first, as sessionList() returns them

// One session at a time (the default): its own runs (plus runs without a session) and tasks.
{
  const v = web(null).view(S, list);
  assert.strictEqual(v.curSession, 'sa');
  assert.deepStrictEqual(v.runs.map((r) => r.id), ['r1', 'r3']);
  assert.strictEqual(v.todos.length, 1);
  assert.strictEqual(v.groups, null);
  console.log('ok - one session: its runs and tasks only');
}
{
  const v = web('sb').view(S, list);
  assert.strictEqual(v.curSession, 'sb');
  assert.deepStrictEqual(v.runs.map((r) => r.id), ['r2', 'r3']);
  assert.strictEqual(v.todos.length, 2);
  assert.strictEqual(v.groups, null);
  console.log('ok - picked session: its runs and tasks only');
}

// All sessions: every run and every task, with the tasks grouped by session.
{
  const v = web('__all').view(S, list);
  assert.strictEqual(v.curSession, '__all');
  assert.deepStrictEqual(v.runs.map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.strictEqual(v.todos.length, 3);
  assert.deepStrictEqual(v.groups.map((g) => g.title), ['Refactor', 'Docs']);
  assert.strictEqual(v.groups[0].goal.text, 'Clean up');
  assert.strictEqual(v.groups[1].todos.length, 2);
  assert.strictEqual(v.goal, null);
  console.log('ok - all sessions: every run and task, grouped by session');
}
{
  const v = web('__all').view(S, [a]);
  assert.strictEqual(v.groups, null);
  assert.strictEqual(v.curSession, 'sa');
  console.log('ok - all sessions with only one session: same as that session');
}

// Tabs: "All sessions" comes first and is marked on when it is the choice; no tabs for one session.
{
  const html = web('__all').tabsHtml(list, '__all', NOW);
  assert.ok(html.includes('data-sid="__all" class="stab on"'), 'All sessions should be on');
  assert.ok(html.includes('All sessions'), 'All sessions label');
  assert.ok(html.indexOf('data-sid="__all"') < html.indexOf('data-sid="sa"'), 'All sessions comes first');
  console.log('ok - tabs: All sessions first and selected');
}
{
  const html = web('sa').tabsHtml(list, 'sa', NOW);
  assert.ok(html.includes('data-sid="__all" class="stab"'), 'All sessions should not be on');
  console.log('ok - tabs: All sessions not selected in a single session');
}
{
  assert.strictEqual(web('sa').tabsHtml([a], 'sa', NOW), '');
  console.log('ok - no tabs when there is only one session');
}

// Render smoke test: the whole script runs in a fake page, and render() builds each view without an error.
{
  const vm = require('vm');
  const T0 = Date.now();
  const sess = {
    sa: { id: 'sa', title: 'Refactor', lastSeen: T0, todos: a.todos, goal: { text: 'Clean up' }, context: { percent: 40, used: 80000, max: 200000 } },
    sb: { id: 'sb', title: 'Docs', lastSeen: T0 - 1000, todos: b.todos },
  };
  const runs = [
    { id: 'r1', title: 'Build', status: 'running', session: 'sa', startedAt: T0 - 60000, lastActivityAt: T0 - 1000, plain: 'Building', now: 'Compiling', steps: [{ title: 'Compile', status: 'doing', startedAt: T0 - 30000, etaSeconds: 60, etaSetAt: T0 - 30000 }], jobs: [] },
    { id: 'r2', title: 'Lint', status: 'running', session: 'sb', startedAt: T0 - 20000, lastActivityAt: T0 - 1000, steps: [{ title: 'Scan', status: 'todo' }], jobs: [] },
    { id: 'r3', title: 'Old run', status: 'done', startedAt: T0 - 3600000, endedAt: T0 - 3000000, summary: 'All good', steps: [] },
  ];
  const full = { session: 'sa', updatedAt: T0, activity: [{ at: T0 - 1000, text: 'Compiling the project' }], history: {}, todos: a.todos, runs, sessions: sess };
  const page = (sel, state) => {
    const app = { innerHTML: '', addEventListener() {} };
    const handlers = {};
    const sandbox = {
      document: { getElementById: (id) => (id === 'app' ? app : null) },
      window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
      acquireVsCodeApi: () => ({ postMessage() {}, getState: () => (sel ? { sel } : {}), setState() {} }),
      setInterval: () => 0,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    handlers.message({ data: { type: 'state', state: state, cfg: { staleMinutes: 3 }, usage: null } });
    return app.innerHTML;
  };
  {
    const html = page('__all', full);
    assert.ok(html.includes('data-sid="__all" class="stab on"'), 'All sessions tab is on');
    assert.ok(html.includes("Agent tasks (all sessions)"), 'tasks heading for all sessions');
    assert.ok(html.includes('class="grph"') && html.includes('Refactor') && html.includes('Docs'), 'tasks grouped by session');
    assert.ok(html.includes('Clean up'), "a session's goal is shown under its name");
    assert.ok(html.includes('class="others"') && html.includes('Build'), 'other running run is listed');
    assert.ok(html.includes("Agent memory in each chat"), 'memory card per chat');
    assert.ok(html.includes('<details id="hist" open>'), 'run history is open');
    console.log('ok - render: all sessions shows groups, other runs, memory per chat, open history');
  }
  {
    const html = page('sa', full);
    assert.ok(!html.includes('(all sessions)'), 'one session has no grouped heading');
    assert.ok(html.includes("Agent tasks</h3>"), 'one session heading');
    assert.ok(!html.includes('class="others"'), 'one session lists no other runs');
    assert.ok(html.includes('<details id="hist" open>'), 'run history is open in one session too');
    console.log('ok - render: one session shows only its own tasks and history');
  }
  {
    const html = page(null, { session: 'sa', updatedAt: T0, activity: [], history: {}, todos: [], runs: [], sessions: {} });
    assert.ok(html.includes('Agent Dashboard'), 'empty state renders');
    console.log('ok - render: empty state');
  }
}

// Session icons: each session tab shows its agent; a session saved before the agent was stored shows Claude.
{
  const c = { id: 'sc', title: 'Port', agent: 'codex', lastSeen: NOW - 2000, todos: [] };
  const p = { id: 'sp', title: 'Copy', agent: 'copilot', lastSeen: NOW - 3000, todos: [] };
  const tabs = web('sc').tabsHtml([a, c, p], 'sc', NOW);
  assert.ok(tabs.includes('aria-label="Codex"'), 'Codex icon on its tab');
  assert.ok(tabs.includes('aria-label="GitHub Copilot"'), 'Copilot icon on its tab');
  assert.ok(tabs.includes('aria-label="Claude"'), 'Claude icon for a session without an agent');
  console.log('ok - tabs: each session shows its agent icon');
}

// Usage card: the raw HTTP error never shows; a rate limit or another failure gets a short text.
{
  const usage = new Function('esc', 'num', 'bar', [grab('usageHtml'), 'return usageHtml;'].join('\n'))(esc, String, () => '');
  const busy = usage({ error: 'rate-limited' }, NOW);
  assert.ok(busy.includes('limiting usage checks'), 'rate limit: short text');
  assert.ok(!/http|429|Could not read/.test(busy), 'no raw HTTP error');
  assert.ok(usage({ error: 'unavailable' }, NOW).includes('not available right now'), 'other failure: short text');
  assert.ok(usage({ error: 'not-logged-in' }, NOW).includes('Not signed in'), 'no login: same text as before');
  console.log('ok - usage card: a rate limit or failure shows a short text, never the HTTP error');
}

// Settings popover: the gear opens it, a click outside closes it, a switch shows the saved value and is sent to the extension.
{
  const vm = require('vm');
  const app = { innerHTML: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } };
  const winHandlers = {};
  const posted = [];
  const sandbox = {
    document: { getElementById: (id) => (id === 'app' ? app : null) },
    window: { addEventListener: (type, fn) => { winHandlers[type] = fn; } },
    acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(m), getState: () => ({}), setState() {} }),
    setInterval: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const T0 = Date.now();
  const state = { session: 'sa', updatedAt: T0, activity: [], history: {}, todos: [], runs: [], sessions: {} };
  winHandlers.message({ data: { type: 'state', state, cfg: { staleMinutes: 3 }, usage: null, settings: { localApi: false } } });
  assert.ok(app.innerHTML.includes('data-gear'), 'gear is in the header');
  assert.ok(!app.innerHTML.includes('class="pop"'), 'popover is closed at first');
  app.handlers.click({ target: { closest: (s) => (s === '[data-gear]' ? {} : null) } });
  assert.ok(app.innerHTML.includes('class="pop"'), 'gear opens the popover');
  assert.ok(!/data-set="localApi"[^>]*checked/.test(app.innerHTML), 'localApi shows off');
  assert.ok(/data-set="usageEstimate"[^>]*checked/.test(app.innerHTML), 'usageEstimate shows on');
  app.handlers.click({ target: { closest: () => null } });
  assert.ok(!app.innerHTML.includes('class="pop"'), 'a click outside closes it');
  app.handlers.click({ target: { closest: (s) => (s === '[data-gear]' ? {} : null) } });
  app.handlers.change({ target: { getAttribute: (a) => (a === 'data-set' ? 'localApi' : null), checked: true } });
  // The posted object was made inside the page's own realm, so compare it as plain data.
  const sent = JSON.parse(JSON.stringify(posted[posted.length - 1]));
  assert.deepStrictEqual(sent, { type: 'setSettings', settings: { localApi: true } });
  assert.ok(/data-set="localApi"[^>]*checked/.test(app.innerHTML), 'the switch shows the new value at once');
  console.log('ok - render: settings popover opens, closes, and sends a change');
}

console.log('all All sessions tests passed');
