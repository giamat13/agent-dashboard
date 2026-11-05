#!/usr/bin/env node
'use strict';
// CLI ש-Claude מריץ כדי לדווח התקדמות ללוח הבקרה ב-VS Code.
const S = require('./lib/state');

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) flags[a.slice(2)] = true;
    else { flags[a.slice(2)] = n; i++; }
  } else pos.push(a);
}

const die = (m) => { console.error(m); process.exit(1); };
const root = S.findRoot(process.cwd());
const st = S.load(root);
const now = Date.now();

const cur = () => S.activeRun(st);
const need = () => cur() || die('No active run. First: run start "Title" --plain "Simple explanation" --steps "step1|step2"');
const curStep = (r) => r.steps.find((s) => s.status === 'doing');
const needStep = (r) => curStep(r) || die('No active step. First: step start <name or number>');
const log = (r, m) => { r.logs.push({ t: now, msg: m }); if (r.logs.length > 200) r.logs.splice(0, r.logs.length - 200); S.logActivity(st, m, now); };
const mkStep = (spec) => {
  const [title, plain] = String(spec).split('::');
  return { title: title.trim(), plain: (plain || '').trim(), status: 'todo', subs: [] };
};
// "Users~2m" = sub-step "Users" with an estimate of 2 minutes
const mkSub = (t) => { const [title, eta] = String(t).split('~'); const x = { title: title.trim(), status: 'todo' }; const sec = eta ? S.parseDuration(eta.trim()) : null; if (sec !== null) x.etaSeconds = sec; return x; };
const mkSubs = (str) => String(str).split('|').map(mkSub).filter((x) => x.title);
const touchSub = (x, status) => {
  x.status = status;
  if (status === 'doing') { x.startedAt = now; delete x.endedAt; if (x.etaSeconds) x.etaSetAt = now; }
  else { x.endedAt = now; if (!x.startedAt) x.startedAt = now; }
};
const setEta = (o, v) => {
  const sec = S.parseDuration(v);
  if (sec === null) die('Invalid time: ' + v + ' (examples: 90s, 5m, 1h30m)');
  o.etaSeconds = sec;
  o.etaSetAt = now;
  return sec;
};
const closeStep = (s, status) => {
  s.status = status; s.endedAt = now;
  const r = cur();
  if (r && status === 'done' && s.startedAt) S.histSet(st, 'step:' + r.title + '/' + s.title, (now - s.startedAt) / 1000);   // remembered as the estimate for next time
};

// A run whose steps are all still "todo" shows no progress: start the first one automatically.
function ensureStep(r) {
  if (!r.steps.length || r.steps.some((x) => x.status === 'doing')) return;
  const s = r.steps.find((x) => x.status === 'todo');
  if (!s) return;
  s.status = 'doing'; s.startedAt = now; delete s.endedAt;
}
// "33 of 36" / "33/36" / "45%" in a status line becomes real progress for the current step.
function progressFromText(r, text) {
  const s = r.steps.find((x) => x.status === 'doing');
  if (!s) return;
  let m = /(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(text);
  let f = m && +m[2] > 0 ? +m[1] / +m[2] : null;
  if (f === null) { m = /(\d{1,3})\s*%/.exec(text); if (m) f = +m[1] / 100; }
  if (f !== null && f >= 0 && f <= 1) s.frac = f;
}

const [cmd, sub, arg] = pos;

switch (cmd) {
  case 'run': {
    if (sub === 'start') {
      const title = arg || die('Missing title');
      for (const r of st.runs) if (r.status === 'running' && (!r.session || !st.session || r.session === st.session)) { r.status = 'stopped'; r.endedAt = now; }
      const run = {
        id: 'r' + now.toString(36), title, plain: flags.plain || '', command: flags.cmd || '',
        status: 'running', session: st.session || '', startedAt: now, lastActivityAt: now, now: '',
        steps: flags.steps ? String(flags.steps).split('|').map(mkStep) : [], logs: [],
      };
      if (flags.eta) setEta(run, flags.eta);
      else { const h = S.histGet(st, 'run:' + title); if (h) { run.etaSeconds = h; run.etaSetAt = now; run.etaFromHistory = true; } }
      ensureStep(run);
      log(run, 'Started: ' + title);
      st.runs.push(run);
      console.log('Run started. Next: step start 1 --plain "..." --eta 5m');
    } else if (sub === 'done' || sub === 'fail') {
      const r = need();
      const s = curStep(r);
      if (s) closeStep(s, sub === 'done' ? 'done' : 'failed');
      r.status = sub === 'done' ? 'done' : 'failed';
      r.endedAt = now;
      r.lastActivityAt = now;
      if (flags.summary) r.summary = String(flags.summary);
      if (sub === 'done') S.histSet(st, 'run:' + r.title, (now - r.startedAt) / 1000);
      if (sub === 'fail' && flags.detail) r.failDetail = String(flags.detail).slice(-600);
      (r.jobs || []).forEach((j) => { if (j.state === 'run') { j.state = sub === 'done' ? 'done' : 'fail'; j.ended = now; j.took = (now - (j.began || now)) / 1000; } });
      log(r, (sub === 'done' ? 'Finished successfully' : 'Failed') + (flags.summary ? ': ' + flags.summary : ''));
      console.log('Run marked: ' + r.status);
    } else die('run start|done|fail');
    break;
  }
  case 'step': {
    const r = need();
    if (sub === 'start') {
      const target = arg || die('Missing step name or number');
      let s;
      if (/^\d+$/.test(target) && r.steps[+target - 1]) s = r.steps[+target - 1];
      else s = r.steps.find((x) => x.title.toLowerCase() === target.toLowerCase());
      if (!s) { s = mkStep(target); r.steps.push(s); }
      for (const o of r.steps) if (o.status === 'doing' && o !== s) closeStep(o, 'done');
      s.status = 'doing';
      s.startedAt = now;
      delete s.endedAt;
      if (flags.plain) s.plain = String(flags.plain);
      if (flags.subs) s.subs = mkSubs(flags.subs);
      let fromHist = false;
      if (flags.eta) setEta(s, flags.eta);
      else { const h = S.histGet(st, 'step:' + r.title + '/' + s.title); if (h) { s.etaSeconds = h; s.etaSetAt = now; fromHist = true; } }
      r.now = flags.now ? String(flags.now) : s.plain || s.title;
      log(r, 'Step: ' + s.title);
      console.log('Step started: ' + s.title + (flags.eta ? '' : fromHist ? '  (estimate taken from the last run; update it with eta if it differs)' : '  (missing --eta, add an estimated time!)'));
    } else if (sub === 'done' || sub === 'fail') {
      const s = needStep(r);
      if (sub === 'done') s.subs.forEach((x) => { if (x.status !== 'failed') x.status = 'done'; });
      closeStep(s, sub === 'done' ? 'done' : 'failed');
      if (arg) s.note = String(arg);
      log(r, (sub === 'done' ? 'Step finished: ' : 'Step failed: ') + s.title + (arg ? ' - ' + arg : ''));
      console.log('Step marked: ' + s.status);
    } else die('step start|done|fail');
    r.lastActivityAt = now;
    break;
  }
  case 'sub': {
    const r = need();
    const s = needStep(r);
    if (sub === 'add') {
      s.subs.push(...mkSubs(arg || die('Missing text')));
    } else if (sub === 'start' || sub === 'done' || sub === 'fail') {
      const status = { start: 'doing', done: 'done', fail: 'failed' }[sub];
      if (arg === 'all') s.subs.forEach((x) => touchSub(x, status));
      else {
        const x = arg ? s.subs[+arg - 1] : s.subs.find((y) => y.status === 'doing') || s.subs.find((y) => y.status === 'todo');
        if (!x) die('Sub-step not found');
        touchSub(x, status);
        if (flags.eta) { const sec = S.parseDuration(flags.eta); if (sec === null) die('Invalid time: ' + flags.eta); x.etaSeconds = sec; x.etaSetAt = now; }
        if (flags.note) x.note = String(flags.note);
        log(r, 'Sub-step ' + (status === 'done' ? 'finished' : status === 'doing' ? 'started' : 'failed') + ': ' + x.title);
      }
    } else die('sub add|start|done|fail');
    r.lastActivityAt = now;
    console.log('Sub-steps updated');
    break;
  }
  case 'eta': {
    const r = need();
    const val = sub || die('Missing time, e.g. eta 8m');
    ensureStep(r);
    const sec = setEta(flags.total ? r : needStep(r), val);
    if (flags.note) r.now = String(flags.note);
    log(r, 'Time estimate updated: ' + Math.round(sec / 60) + ' min' + (flags.total ? ' (total)' : ''));
    r.lastActivityAt = now;
    console.log('ETA updated (' + Math.round(sec / 60) + ' min from now)');
    break;
  }
  case 'now': {
    const r = need();
    r.now = sub || die('Missing text');
    ensureStep(r);
    progressFromText(r, r.now);
    log(r, r.now);
    r.lastActivityAt = now;
    console.log('Updated');
    break;
  }
  case 'log': {
    // Live log line ("what is happening right now"). Works with or without an active run.
    const text = sub || die('Missing text');
    const r = cur();
    if (r) { log(r, text); r.lastActivityAt = now; } else S.logActivity(st, text, now);
    console.log('Logged');
    break;
  }
  case 'job': {
    // Parallel things being checked (tests, services, builds): job add "a|b" | job start|done|fail <name> [--plain --eta --summary --detail] | job live <name> --pass N --fail M --last "line"
    const r = need();
    r.jobs = r.jobs || [];
    const find = (n) => r.jobs.find((x) => x.name.toLowerCase() === String(n).toLowerCase());
    if (sub === 'add') {
      String(arg || die('Missing names: "a|b|c"')).split('|').map((x) => x.trim()).filter(Boolean).forEach((n) => { if (!find(n)) r.jobs.push({ name: n, plain: '', state: 'todo' }); });
    } else {
      const name = arg || die('Missing job name');
      let j = find(name);
      if (sub === 'start') {
        if (!j) { j = { name, plain: '', state: 'todo' }; r.jobs.push(j); }
        j.state = 'run'; j.began = now; delete j.ended; delete j.took;
        if (flags.plain) j.plain = String(flags.plain);
        const sec = flags.eta ? S.parseDuration(flags.eta) : S.histGet(st, 'job:' + r.title + '/' + j.name);
        if (sec) j.estimate = sec;
        log(r, 'Started: ' + name);
      } else if (sub === 'done' || sub === 'fail') {
        if (!j) die('No such job: ' + name);
        j.state = sub === 'done' ? 'done' : 'fail'; j.ended = now; j.took = (now - (j.began || now)) / 1000;
        if (flags.summary) j.summary = String(flags.summary);
        if (flags.detail) j.detail = String(flags.detail).slice(-600);
        if (sub === 'done') S.histSet(st, 'job:' + r.title + '/' + j.name, j.took);
        log(r, (sub === 'done' ? 'Finished: ' : 'FAILED: ') + name + (flags.summary ? ' (' + flags.summary + ')' : ''));
      } else if (sub === 'live') {
        if (!j) die('No such job: ' + name);
        j.live = { pass: +flags.pass || 0, fail: +flags.fail || 0, last: flags.last ? [String(flags.last).slice(0, 150)] : (j.live && j.live.last) || [] };
      } else die('job add|start|done|fail|live');
    }
    r.lastActivityAt = now;
    console.log('Jobs: ' + r.jobs.map((x) => `${x.name}[${x.state}]`).join(' '));
    break;
  }
  case 'goal': {
    // goal "text" | goal clear  (the dashboard shows it at the top)
    const t = pos.slice(1).join(' ').trim();
    if (!t || /^(clear|off|none)$/i.test(t)) { st.goal = null; console.log('Goal cleared'); }
    else { st.goal = { text: t.slice(0, 500), at: now }; S.logActivity(st, 'Goal set: ' + t.slice(0, 120), now); console.log('Goal set'); }
    break;
  }
  case 'reset': {
    // Put the current page away (archive) and start clean. History of durations is kept (it feeds the estimates).
    const fs = require('fs'), path = require('path');
    const dir = path.join(root, S.DIR, 'archive');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, new Date(now).toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(f, JSON.stringify({ todos: st.todos, activity: st.activity, runs: st.runs }, null, 1));
    st.todos = []; st.activity = []; st.runs = [];
    console.log('Archived to ' + f + ' and cleared');
    break;
  }
  case 'todo': {
    // Fallback when TodoWrite is not available: todo set "a|[~] b|[x] c" | todo doing|done|pending <n>
    const mk = (t, i) => {
      let status = 'pending';
      const m = /^\[(x|~| )\]\s*/i.exec(t);
      if (m) { status = m[1] === '~' ? 'in_progress' : m[1].toLowerCase() === 'x' ? 'completed' : 'pending'; t = t.slice(m[0].length); }
      return { id: String(i + 1), content: t.trim(), activeForm: t.trim(), status };
    };
    if (sub === 'set') {
      st.todos = String(arg || die('Missing items: "a|b|c"')).split('|').filter((x) => x.trim()).map(mk);
    } else if (sub === 'add') {
      st.todos.push(mk(String(arg || die('Missing text')), st.todos.length));
    } else if (['doing', 'done', 'pending'].includes(sub)) {
      const t = st.todos.find((x) => x.id === String(arg));
      if (!t) die('No such TODO: ' + arg);
      t.status = sub === 'doing' ? 'in_progress' : sub === 'done' ? 'completed' : 'pending';
      if (t.status === 'in_progress') t.startedAt = now; else if (t.status === 'completed') { t.endedAt = now; if (!t.startedAt) t.startedAt = now; }
    } else if (sub === 'clear') st.todos = [];
    else die('Usage: todo set "a|[~] b|[x] c" | todo doing|done|pending <n> | todo clear');
    console.log('TODOs: ' + st.todos.map((t) => `${t.id}.[${t.status}] ${t.content}`).join(' ; '));
    break;
  }
  case 'clear': {
    st.runs = [];
    st.activity = [];
    console.log('History cleared');
    break;
  }
  case 'status': {
    const r = cur();
    if (!r) { console.log('No active run'); process.exit(0); }
    console.log(r.title + ' | ' + r.status);
    r.steps.forEach((s, i) => console.log(`${i + 1}. [${s.status}] ${s.title}`));
    process.exit(0);
  }
  default:
    die('Usage: dash.js run start|done|fail | step start|done|fail | sub add|start|done | eta <time> | now "..." | log "..." | job add|start|done|fail|live | todo set|add|doing|done | status | reset | clear');
}

// Keep this session's own slice in sync, otherwise the next hook would overwrite todos/goal set here.
if (st.session && st.sessions && st.sessions[st.session]) Object.assign(st.sessions[st.session], { todos: st.todos, goal: st.goal });
S.save(root, st);
