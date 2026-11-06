'use strict';
// Read-only local API for other tools on this computer (dash.js status, scripts, other apps).
// - Listens on 127.0.0.1 only, on a free port. The port is written to <folder>/.agent-dashboard/api.json.
// - Answers GET (and HEAD) with JSON. Anything else is refused.
// - No CORS headers, and any request with an Origin header is refused: a web page cannot read the answers.
// - The Host header must name 127.0.0.1 or localhost on this port, which blocks DNS rebinding from a web page.
// - It serves the dashboard's own data only. The Claude login token is never read here and never served.
const http = require('http');
const fs = require('fs');
const path = require('path');

const NAME = 'agent-dashboard';
const INFO_FILE = 'api.json';

function send(res, code, body, extra) {
  const text = JSON.stringify(body, null, 1);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, extra || {}));
  res.end(text);
}

// Each route returns [status, body]. A null body means "nothing yet" and gives 404.
const ROUTES = {
  '/api/health': (c) => [200, { ok: true, name: NAME, version: c.version, pid: process.pid, startedAt: c.startedAt, routes: Object.keys(ROUTES) }],
  '/api/state': (c) => { const s = c.getState(); return s ? [200, s] : [404, { error: 'no-state', message: 'No dashboard state in this folder yet.' }]; },
  '/api/usage': (c) => { const u = c.getUsage(); return u ? [200, u] : [404, { error: 'no-usage-yet', message: 'The plan limits have not been read yet.' }]; },
  '/api/providers': (c) => { const p = c.getProviders(); return p ? [200, p] : [404, { error: 'no-providers-yet', message: 'The Codex and Copilot limits have not been read yet.' }]; },
  '/api/github': (c) => { const g = c.getGithub(); return g ? [200, g] : [404, { error: 'no-github-yet', message: 'The GitHub Actions card has no data yet.' }]; },
};

function handler(c) {
  return (req, res) => {
    const port = c.port();
    const host = String(req.headers.host || '');
    if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return send(res, 403, { error: 'bad-host' });
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'origin-not-allowed' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
    const p = new URL(req.url || '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/';
    const route = ROUTES[p];
    if (!route) return send(res, 404, { error: 'not-found', routes: Object.keys(ROUTES) });
    let out;
    try { out = route(c); } catch (e) { return send(res, 500, { error: 'internal', message: String((e && e.message) || e) }); }
    const [code, body] = out;
    send(res, code, body);
  };
}

function writeInfo(dirs, info) {
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, INFO_FILE), JSON.stringify(info, null, 1) + '\n');
    } catch { /* a folder we cannot write to: the API still runs */ }
  }
}

// Removes the address file only when it still belongs to this process (another window may have written its own).
function removeInfo(dirs, pid) {
  for (const dir of dirs) {
    const f = path.join(dir, INFO_FILE);
    try {
      if (JSON.parse(fs.readFileSync(f, 'utf8')).pid === pid) fs.unlinkSync(f);
    } catch { /* no file */ }
  }
}

// Starts the API. opts: { version, infoDirs: [folder/.agent-dashboard, ...], getState(), getUsage(), getGithub() }.
// Resolves to { port, url, close() }. close() stops the server and removes the address files.
function start(opts) {
  const dirs = (opts.infoDirs || []).slice();
  const c = {
    version: String(opts.version || ''),
    startedAt: new Date().toISOString(),
    getState: opts.getState || (() => null),
    getUsage: opts.getUsage || (() => null),
    getProviders: opts.getProviders || (() => null),
    getGithub: opts.getGithub || (() => null),
    port: () => server.address().port,
  };
  const server = http.createServer(handler(c));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const port = server.address().port;
      writeInfo(dirs, { name: NAME, port, url: 'http://127.0.0.1:' + port, pid: process.pid, version: c.version, startedAt: c.startedAt });
      let closed = null;
      resolve({
        port,
        url: 'http://127.0.0.1:' + port,
        close() {
          if (closed) return closed;
          removeInfo(dirs, process.pid);
          closed = new Promise((done) => {
            if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
            server.close(() => done());
          });
          return closed;
        },
      });
    });
  });
}

module.exports = { start, ROUTES, INFO_FILE };
