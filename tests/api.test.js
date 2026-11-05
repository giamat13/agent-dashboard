// Tests for the read-only local API (vscode-extension/lib/api.js). Run: node tests/api.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const API = require('../vscode-extension/lib/api');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-api-'));
const dir = path.join(tmp, 'project', '.agent-dashboard');
let state = { runs: [], todos: [{ id: '1', content: 'Write the readme', status: 'pending' }] };
let usage = { fiveHour: { pct: 45, resetsAt: null }, weekly: { pct: 14, resetsAt: null }, opus: null, fetchedAt: 1 };
let github = null;

// One request, with no keep-alive, so closing the server never waits.
function req(port, o) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: o.path || '/', method: o.method || 'GET', headers: o.headers || {}, agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const api = await API.start({ version: '9.9.9', infoDirs: [dir], getState: () => state, getUsage: () => usage, getGithub: () => github });
  try {
    // Only the loopback address, and the address file tells where it is.
    const info = JSON.parse(fs.readFileSync(path.join(dir, API.INFO_FILE), 'utf8'));
    assert.strictEqual(info.port, api.port);
    assert.strictEqual(info.pid, process.pid);
    assert.strictEqual(info.url, 'http://127.0.0.1:' + api.port);
    console.log('ok - listens on 127.0.0.1 and writes its address file');

    // Health, state and usage.
    let r = await req(api.port, { path: '/api/health' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(JSON.parse(r.body).version, '9.9.9');
    assert.strictEqual(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    r = await req(api.port, { path: '/api/state' });
    assert.deepStrictEqual(JSON.parse(r.body), state);
    r = await req(api.port, { path: '/api/usage/' });   // a trailing slash is the same route
    assert.deepStrictEqual(JSON.parse(r.body), usage);
    console.log('ok - health, state and usage answer with JSON');

    // Never a CORS header, so a web page cannot read the answers.
    r = await req(api.port, { path: '/api/state', headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(r.code, 403, 'a request with an Origin header is refused');
    assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')));
    console.log('ok - no CORS headers; requests with an Origin header are refused');

    // DNS rebinding: any other Host name is refused.
    r = await req(api.port, { path: '/api/health', headers: { Host: 'evil.example:' + api.port } });
    assert.strictEqual(r.code, 403);
    r = await req(api.port, { path: '/api/health', headers: { Host: 'localhost:' + api.port } });
    assert.strictEqual(r.code, 200, 'localhost is allowed');
    console.log('ok - only 127.0.0.1 and localhost names are accepted');

    // Read only.
    r = await req(api.port, { path: '/api/state', method: 'POST' });
    assert.strictEqual(r.code, 405);
    assert.strictEqual(r.headers.allow, 'GET, HEAD');
    r = await req(api.port, { path: '/api/health', method: 'OPTIONS' });
    assert.strictEqual(r.code, 405, 'no CORS preflight answer');
    r = await req(api.port, { path: '/api/health', method: 'HEAD' });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body, '');
    console.log('ok - read only: other methods are refused, HEAD has no body');

    // Unknown paths and nothing-yet answers.
    r = await req(api.port, { path: '/nope' });
    assert.strictEqual(r.code, 404);
    assert.ok(JSON.parse(r.body).routes.includes('/api/state'));
    state = null;
    r = await req(api.port, { path: '/api/state' });
    assert.strictEqual(r.code, 404);
    assert.strictEqual(JSON.parse(r.body).error, 'no-state');
    usage = null;
    r = await req(api.port, { path: '/api/usage' });
    assert.strictEqual(JSON.parse(r.body).error, 'no-usage-yet');
    r = await req(api.port, { path: '/api/github' });
    assert.strictEqual(JSON.parse(r.body).error, 'no-github-yet');
    github = { repo: 'giamat13/agent-dashboard', runs: [] };
    r = await req(api.port, { path: '/api/github' });
    assert.deepStrictEqual(JSON.parse(r.body), github);
    console.log('ok - unknown paths give 404; nothing-yet answers are clear');
  } finally {
    await api.close();
  }
  assert.ok(!fs.existsSync(path.join(dir, API.INFO_FILE)), 'the address file is removed on close');
  console.log('ok - close removes the address file');

  // Another window writes its own address file while ours runs: closing ours leaves that one alone.
  const again = await API.start({ version: '9.9.9', infoDirs: [dir], getState: () => state });
  const other = { name: 'agent-dashboard', port: 1, pid: process.pid + 100000 };
  fs.writeFileSync(path.join(dir, API.INFO_FILE), JSON.stringify(other));
  await again.close();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, API.INFO_FILE), 'utf8')), other);
  console.log('ok - an address file of another process is not removed');

  // dash.js status tells whether the API runs: the address file must belong to a live process.
  const { spawnSync } = require('child_process');
  const DASH = path.join(__dirname, '..', 'claude-plugin', 'scripts', 'dash.js');
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: path.join(tmp, 'project'), AGENT_DASH_HOME: tmp });
  let out = spawnSync(process.execPath, [DASH, 'status'], { env, encoding: 'utf8', timeout: 30000 }).stdout;
  assert.ok(/API: not running/.test(out), out);
  const live = await API.start({ version: '9.9.9', infoDirs: [dir], getState: () => state });
  try {
    out = spawnSync(process.execPath, [DASH, 'status'], { env, encoding: 'utf8', timeout: 30000 }).stdout;
    assert.ok(out.includes('API: running at http://127.0.0.1:' + live.port), out);
  } finally {
    await live.close();
  }
  console.log('ok - dash.js status shows the API address while it runs');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('all api tests passed');
})().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
