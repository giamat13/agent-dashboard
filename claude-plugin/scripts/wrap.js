#!/usr/bin/env node
'use strict';
// מריץ סקריפט אמיתי ומחבר אותו ללוח בקרה בלייב: דופק חיים, שורת פלט אחרונה,
// זיהוי אחוזים/מונים בפלט, וחישוב זמן משוער אוטומטי. לא תלוי ב-Claude.
//
// Usage: node wrap.js --title "Tests" [--plain "Explanation"] [--steps "a::explain|b"] [--eta 10m] -- npm test
//
// הסקריפט עצמו יכול לדווח בעזרת שורות בפלט:
//   @@step <number|name>   @@sub done|start|add [n|text]   @@now text   @@eta 5m   @@job start|done|fail <name>
const { spawn } = require('child_process');
const S = require('./lib/state');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0 || sep === argv.length - 1) {
  console.error('Usage: wrap.js --title "Title" [--plain "Explanation"] [--steps "a::explain|b"] [--eta 10m] -- <command>');
  process.exit(2);
}
const opts = {};
const head = argv.slice(0, sep);
for (let k = 0; k < head.length; k++) if (head[k].startsWith('--')) { opts[head[k].slice(2)] = head[k + 1]; k++; }
const cmd = argv.slice(sep + 1).map((a) => (/\s/.test(a) && !/^["']/.test(a) ? `"${a}"` : a)).join(' ');

const root = S.findRoot(process.cwd());
const startedAt = Date.now();
const id = 'r' + startedAt.toString(36);
const mkStep = (spec) => { const [t, p] = String(spec).split('::'); return { title: t.trim(), plain: (p || '').trim(), status: 'todo', subs: [] }; };

{
  const st = S.load(root);
  for (const r of st.runs) if (r.status === 'running' && (!r.session || !st.session || r.session === st.session)) { r.status = 'stopped'; r.endedAt = startedAt; }
  const steps = opts.steps ? opts.steps.split('|').map(mkStep) : [{ title: opts.title || 'Run', plain: '', status: 'todo', subs: [] }];
  steps[0].status = 'doing';
  steps[0].startedAt = startedAt;
  const run = {
    id, title: opts.title || cmd.slice(0, 60), plain: opts.plain || '', command: cmd, status: 'running', wrapped: true,
    startedAt, lastActivityAt: startedAt, lastOutputAt: null, lastLine: '', now: '', steps, logs: [{ t: startedAt, msg: 'Started: ' + cmd }],
  };
  run.session = st.session || '';
  run.jobs = [];
  run.live = { pass: 0, fail: 0, last: [] };
  if (opts.eta) { const s = S.parseDuration(opts.eta); if (s) { run.etaSeconds = s; run.etaSetAt = startedAt; } }
  else { const h = S.histGet(st, 'run:' + run.title); if (h) { run.etaSeconds = h; run.etaSetAt = startedAt; run.etaFromHistory = true; } }
  if (steps[0]) { const h = S.histGet(st, 'step:' + run.title + '/' + steps[0].title); if (h && !steps[0].etaSeconds) { steps[0].etaSeconds = h; steps[0].etaSetAt = startedAt; } }
  S.logActivity(st, 'Started: ' + run.title, startedAt);
  st.runs.push(run);
  S.save(root, st);
}

let frac = null, lastLine = '', lastOutputAt = null, manualNow = false, manualEta = false, buf = '', finished = false;
const ops = [];
const logs = [];
const acts = [];
let failLines = [];

const curStep = (r) => r.steps.find((s) => s.status === 'doing');
const close = (s, status, now, r) => {
  s.status = status; s.endedAt = now;
  if (r && status === 'done' && s.startedAt) { /* duration remembered by caller with state */ }
};

function handleLine(raw) {
  const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
  if (!line) return;
  lastOutputAt = Date.now();
  const mk = /^@@(step|sub|now|eta|job)\s*(.*)$/.exec(line);
  if (mk) {
    const [, kind, rest] = mk;
    ops.push((r, now, st) => {
      if (kind === 'job') {
        const [act, ...tail] = rest.split(/\s+/); const name = tail.join(' ').trim();
        if (!name) return;
        r.jobs = r.jobs || [];
        let j = r.jobs.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (act === 'start') {
          if (!j) { j = { name, plain: '', state: 'todo' }; r.jobs.push(j); }
          j.state = 'run'; j.began = now; delete j.ended; delete j.took;
          const h = S.histGet(st, 'job:' + r.title + '/' + j.name); if (h) j.estimate = h;
          S.logActivity(st, 'Started: ' + name, now);
        } else if (act === 'done' || act === 'fail') {
          if (!j) { j = { name, plain: '', state: 'todo', began: now }; r.jobs.push(j); }
          j.state = act === 'done' ? 'done' : 'fail'; j.ended = now; j.took = (now - (j.began || now)) / 1000;
          if (act === 'done') S.histSet(st, 'job:' + r.title + '/' + j.name, j.took);
          else j.detail = failLines.slice(-4).join('\n').slice(-600);
          S.logActivity(st, (act === 'done' ? 'Finished: ' : 'FAILED: ') + name, now);
        }
        return;
      }
      if (kind === 'now') { r.now = rest; manualNow = true; S.logActivity(st, rest, now); }
      else if (kind === 'eta') { const sec = S.parseDuration(rest); const s = curStep(r); if (sec !== null && s) { s.etaSeconds = sec; s.etaSetAt = now; manualEta = true; } }
      else if (kind === 'step') {
        let s = /^\d+$/.test(rest) ? r.steps[+rest - 1] : r.steps.find((x) => x.title.toLowerCase() === rest.toLowerCase());
        if (!s) { s = mkStep(rest); r.steps.push(s); }
        for (const o of r.steps) if (o.status === 'doing' && o !== s) { close(o, 'done', now); if (o.startedAt) S.histSet(st, 'step:' + r.title + '/' + o.title, (now - o.startedAt) / 1000); }
        s.status = 'doing'; s.startedAt = now; delete s.endedAt; frac = null; manualEta = false; manualNow = false;
        if (!s.etaSeconds) { const h = S.histGet(st, 'step:' + r.title + '/' + s.title); if (h) { s.etaSeconds = h; s.etaSetAt = now; } }
        r.now = s.plain || s.title;
        S.logActivity(st, 'Step: ' + s.title, now);
      } else if (kind === 'sub') {
        const s = curStep(r); if (!s) return;
        const [act, ...tail] = rest.split(/\s+/); const arg = tail.join(' ');
        const mkSub = (t) => { const [title, eta] = t.split('~'); const x = { title: title.trim(), status: 'todo' }; const sec = eta ? S.parseDuration(eta.trim()) : null; if (sec !== null) x.etaSeconds = sec; return x; };
        if (act === 'add') s.subs.push(...arg.split('|').map(mkSub).filter((x) => x.title));
        else {
          const status = { start: 'doing', done: 'done', fail: 'failed' }[act]; if (!status) return;
          const x = /^\d+$/.test(arg) ? s.subs[+arg - 1] : s.subs.find((y) => y.status === 'doing') || s.subs.find((y) => y.status === 'todo');
          if (x) { x.status = status; if (status === 'doing') { x.startedAt = now; if (x.etaSeconds) x.etaSetAt = now; } else { x.endedAt = now; } }
        }
      }
    });
    logs.push(line);
    return;
  }
  lastLine = line.slice(0, 200);
  // Live pass/fail counting from common test-output shapes.
  const isFail = /(^|\s)(FAIL(ED)?|✗|✘|×|not ok)\b|^\s*(Error|AssertionError)\b|\bERROR\b/.test(line) && !/^\s*(0|no)\s+(fail|error)/i.test(line);
  const isPass = !isFail && /(^|\s)(PASS(ED)?|✓|✔)(\s|$)|^ok\s/.test(line);
  if (isFail) failLines.push(line.slice(0, 200));
  if (failLines.length > 20) failLines.shift();
  if (isFail || isPass) {
    ops.push((r, now, st) => {
      r.live = r.live || { pass: 0, fail: 0, last: [] };
      const running = (r.jobs || []).filter((j) => j.state === 'run');
      const byName = (r.jobs || []).find((j) => j.name.length > 2 && line.toLowerCase().includes(j.name.toLowerCase()));
      const target = byName || (running.length === 1 ? running[0] : null);
      const bump = (o) => { o.live = o.live || { pass: 0, fail: 0, last: [] }; if (isFail) o.live.fail++; else o.live.pass++; o.live.last = [...(o.live.last || []), line.slice(0, 150)].slice(-5); };
      bump(r);
      if (target) bump(target);
      if (isFail && r.live.fail === 1) S.logActivity(st, 'First failure: ' + line.slice(0, 120), now);
    });
  }
  let f = null, m;
  if ((m = /\[\s*(\d{1,3})%\]/.exec(line)) || (m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line))) { if (+m[1] <= 100) f = +m[1] / 100; }
  else if ((m = /\[(\d+)\/(\d+)\]/.exec(line)) || (m = /\((\d+)\/(\d+)\)/.exec(line)) || (m = /(\d+)\s+of\s+(\d+)/i.exec(line)) ||
    (m = /(\d+)\/(\d+)\s+(?:tests?|files?|items?|passed|specs?|steps?|packages?)/i.exec(line))) { if (+m[2] > 0 && +m[1] <= +m[2]) f = +m[1] / +m[2]; }
  if (f !== null) frac = f; else logs.push(line);
}

function flush(final) {
  const now = Date.now();
  const st = S.load(root);
  const r = st.runs.find((x) => x.id === id);
  if (!r) return;
  r.lastActivityAt = now;
  if (lastOutputAt) r.lastOutputAt = lastOutputAt;
  if (lastLine) r.lastLine = lastLine;
  for (const op of ops.splice(0)) op(r, now, st);
  for (const l of logs.splice(0)) r.logs.push({ t: now, msg: l });
  if (r.logs.length > 200) r.logs.splice(0, r.logs.length - 200);
  const s = curStep(r);
  if (s && frac !== null) {
    s.frac = frac;
    const elapsed = (now - s.startedAt) / 1000;
    if (!manualEta && frac >= 0.02 && elapsed >= 3) {
      s.etaSeconds = frac >= 1 ? 0 : Math.round((elapsed * (1 - frac)) / frac);
      s.etaSetAt = now;
    }
  }
  if (!manualNow && lastLine && !final) r.now = 'The script is working. Last line it printed: ' + lastLine.slice(0, 120);
  S.save(root, st);
}

const child = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], cwd: process.cwd() });
{
  const st = S.load(root);
  const r = st.runs.find((x) => x.id === id);
  if (r) { r.pid = child.pid; S.save(root, st); }
}
const onData = (stream) => (d) => {
  stream.write(d);
  buf += d.toString('utf8');
  const parts = buf.split(/\r\n|\n|\r/);
  buf = parts.pop();
  parts.forEach(handleLine);
};
child.stdout.on('data', onData(process.stdout));
child.stderr.on('data', onData(process.stderr));
const timer = setInterval(() => flush(false), 1000);

function finish(code, stopped) {
  if (finished) return;
  finished = true;
  clearInterval(timer);
  if (buf) handleLine(buf);
  flush(true);
  const now = Date.now();
  const st = S.load(root);
  const r = st.runs.find((x) => x.id === id);
  if (r) {
    const s = curStep(r);
    const ok = code === 0 && !stopped;
    if (s) {
      if (ok) s.subs.forEach((x) => { if (x.status !== 'failed') x.status = 'done'; });
      close(s, ok ? 'done' : 'failed', now); delete s.etaSetAt;
      if (ok && s.startedAt) S.histSet(st, 'step:' + r.title + '/' + s.title, (now - s.startedAt) / 1000);
    }
    if (ok) r.steps.forEach((x) => { if (x.status === 'todo') x.status = 'done'; });
    (r.jobs || []).forEach((j) => { if (j.state === 'run') { j.state = ok ? 'done' : 'fail'; j.ended = now; j.took = (now - (j.began || now)) / 1000; } });
    if (ok) S.histSet(st, 'run:' + r.title, (now - r.startedAt) / 1000);
    else if (!stopped) r.failDetail = failLines.slice(-6).join('\n').slice(-600) || r.lastLine || '';
    r.status = stopped ? 'stopped' : ok ? 'done' : 'failed';
    r.endedAt = now;
    r.lastActivityAt = now;
    r.now = '';
    r.summary = stopped ? 'Stopped manually' : ok ? 'Finished successfully' : 'Failed (exit code ' + code + ')' + (r.lastLine ? '. Last line: ' + r.lastLine.slice(0, 120) : '');
    r.logs.push({ t: now, msg: r.summary });
    S.logActivity(st, r.summary, now);
    S.save(root, st);
  }
  process.exit(stopped ? 130 : code === null ? 1 : code);
}
child.on('error', (e) => { lastLine = String(e.message); finish(1, false); });
child.on('close', (code) => finish(code, false));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { child.kill(); } catch { /* ignore */ } finish(null, true); });
