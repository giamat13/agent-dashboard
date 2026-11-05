// Smoke test for the GitHub Actions card in the dashboard (vscode-extension/media/main.js). Run: node tests/ghcard.test.js
// The real script runs in a sandbox with a small fake page; the test sends it states and reads back the HTML it writes.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'vscode-extension', 'media', 'main.js'), 'utf8');
const listeners = [];
const app = { innerHTML: '', addEventListener() {} };
const sandbox = {
  window: { addEventListener(type, fn) { if (type === 'message') listeners.push(fn); } },
  document: { getElementById: () => app },
  acquireVsCodeApi: () => ({ postMessage() {}, setState() {}, getState() { return null; } }),
  setInterval: () => 0,   // no timers: the script must not keep this test running
  console,
};
vm.runInNewContext(src, sandbox, { filename: 'main.js' });
assert.strictEqual(listeners.length, 1, 'the page listens for state messages');

const now = Date.now();
const ago = (ms) => new Date(now - ms).toISOString();
const state = { updatedAt: now, todos: [], runs: [], activity: [], sessions: {}, ciEta: {} };
function show(gh) {
  listeners[0]({ data: { type: 'state', state, cfg: { staleMinutes: 3 }, usage: null, settings: { githubActions: true }, gh } });
  return app.innerHTML;
}

// Switch off: no card.
assert.ok(!show({ error: 'off', running: [], recent: [], pages: null }).includes('GitHub Actions'));
// No data yet: no card.
assert.ok(!show(null).includes('GitHub Actions'));
console.log('ok - no card when the switch is off or there is no data yet');

// A running run with Claude's estimate, a finished run, and a Pages deploy.
let html = show({
  repo: 'GIAMAT13/agent-dashboard', error: null, at: now,
  running: [{ title: 'Fix <b>login</b>', workflow: 'CI', branch: 'main', event: 'push', status: 'in_progress', startedAt: ago(120000), estimateSec: 300, estimateFrom: 'claude', url: '' }],
  recent: [{ title: 'Old change', workflow: 'CI', branch: 'main', conclusion: 'failure', durationSec: 90, endedAt: ago(3600000), url: '' }],
  pages: { status: 'completed', conclusion: 'success', at: ago(600000), url: '' },
});
assert.ok(html.includes('GitHub Actions') && html.includes('GIAMAT13/agent-dashboard'), 'the card has its title and the repository');
assert.ok(html.includes("Claude's estimate"), 'the estimate says where it comes from');
assert.ok(/left/.test(html), 'a running run shows the time left');
assert.ok(html.includes('Fix &lt;b&gt;login&lt;/b&gt;'), 'run titles are escaped');
assert.ok(html.includes('Old change') && html.includes('✗'), 'recent runs are listed with their result');
assert.ok(html.includes('<div class="ghpages">GitHub Pages: deployed'), 'the Pages deploy is a small line of its own');
console.log('ok - running, recent and Pages parts are shown');

// A deploy that is going on is shown as deploying.
html = show({ repo: 'a/b', error: null, at: now, running: [], recent: [], pages: { status: 'in_progress', conclusion: '', at: ago(5000), url: '' } });
assert.ok(html.includes('GitHub Pages: deploying'));
assert.ok(html.includes('Nothing running.'));
console.log('ok - a Pages deploy in progress and an empty list');

// Errors: a short reason, and no runs.
html = show({ repo: 'a/b', error: 'not-logged-in', at: now, running: [], recent: [], pages: null });
assert.ok(html.includes('Not logged in to GitHub. Run: gh auth login'));
html = show({ repo: null, error: 'gh-missing', at: now, running: [], recent: [], pages: null });
assert.ok(html.includes('Install the GitHub CLI (gh)'));
console.log('ok - errors show a short reason');

console.log('all ghcard tests passed');
