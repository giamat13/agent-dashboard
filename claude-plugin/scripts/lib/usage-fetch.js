'use strict';
// Child process for lib/usage.js: reads the plan limits once and prints one JSON line. The login token stays in this process
// and is never printed. Errors are reported as short words only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const out = (o) => process.stdout.write(JSON.stringify(o));
const clamp = (x) => Math.min(100, Math.max(0, x));
const pick = (x) => (x && typeof x.utilization === 'number'
  ? { pct: clamp(x.utilization), resetsAt: x.resets_at ? Date.parse(x.resets_at) || null : null }
  : null);

let token = null;
try {
  const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
  token = j.claudeAiOauth && j.claudeAiOauth.accessToken;
} catch { /* no login file */ }

if (!token) {
  out({ ok: false, error: 'not-logged-in' });
} else {
  const req = https.request('https://api.anthropic.com/api/oauth/usage', {
    method: 'GET',
    timeout: 4000,
    headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'agent-dashboard' },
  }, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      if (res.statusCode !== 200) { out({ ok: false, status: res.statusCode }); return; }
      try {
        const j = JSON.parse(body);
        out({ ok: true, fiveHour: pick(j.five_hour), weekly: pick(j.seven_day), opus: pick(j.seven_day_opus) });
      } catch {
        out({ ok: false, error: 'bad-json' });
      }
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (e) => out({ ok: false, error: String((e && e.message) || 'network').slice(0, 80) }));
  req.end();
}
