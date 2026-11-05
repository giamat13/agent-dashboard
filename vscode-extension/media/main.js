(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let S = null, cfg = { staleMinutes: 3 }, last = '', usage = null, hist = {};
  const open = new Set();          // ids of <details> the user opened
  const shown = {};                // smoothed percentages (key -> value), so numbers glide instead of jumping

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') { S = e.data.state; cfg = e.data.cfg || cfg; usage = e.data.usage || null; render(); }
  });
  vscode.postMessage({ type: 'ready' });
  setInterval(() => S && render(), 1000);
  app.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('[data-sid]');
    if (tab) { sel = tab.getAttribute('data-sid'); try { vscode.setState({ sel }); } catch { /* ignore */ } render(); }
  });
  let sel = null;
  try { sel = (vscode.getState() || {}).sel || null; } catch { /* ignore */ }

  // Sessions of this project (the state file is per project). Shown as tabs when there is more than one.
  function sessionList(S) {
    const now = Date.now();
    return Object.values(S.sessions || {}).filter((x) => now - (x.lastSeen || 0) < 3 * 3600e3).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }
  function view(S, list) {
    if (!list.length) return S;
    const cur = list.find((x) => x.id === sel) || list.find((x) => x.id === S.session) || list[0];
    return Object.assign({}, S, {
      todos: cur.todos || [], goal: cur.goal || null, context: cur.context || null, curSession: cur.id,
      runs: (S.runs || []).filter((r) => !r.session || r.session === cur.id),
    });
  }
  function tabsHtml(list, curId, now) {
    if (list.length < 2) return '';
    return '<div class="stabs">' + list.map((x, i) => {
      const busy = (x.todos || []).some((t) => t.status === 'in_progress');
      return '<button data-sid="' + esc(x.id) + '" class="stab' + (x.id === curId ? ' on' : '') + '" title="' + esc(x.title || x.id) + '">' + (busy ? '<i></i>' : '') +
        esc(x.title || ('Session ' + (list.length - i))) + ' <span class="muted">' + (now - (x.lastSeen || 0) < 60000 ? 'now' : hhmm(x.lastSeen)) + '</span></button>';
    }).join('') + '</div>';
  }
  app.addEventListener('toggle', (e) => {
    const id = e.target && e.target.id; if (!id) return;
    if (e.target.open) open.add(id); else open.delete(id);
  }, true);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const det = (id) => '<details id="' + id + '"' + (open.has(id) ? ' open' : '') + '>';

  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return plural(sec, 'second');
    if (sec < 600) return Math.floor(sec / 60) + ' min ' + (sec % 60) + ' s';
    if (sec < 3600) return Math.round(sec / 60) + ' minutes';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return plural(h, 'hour') + (m ? ' ' + m + ' min' : '');
  }
  const clock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const ago = (ms) => (ms < 5000 ? 'just now' : dur(ms / 1000) + ' ago');

  // Percent that glides toward its target (up quickly, never backwards unless the target drops a lot).
  function smooth(key, target) {
    const cur = shown[key];
    if (cur === undefined || target < cur - 1) { shown[key] = target; return target; }
    shown[key] = cur + (target - cur) * 0.5;
    if (Math.abs(target - shown[key]) < 0.5) shown[key] = target;
    return Math.round(shown[key]);
  }

  function ring(pct, color) {
    const R = 34, C = 2 * Math.PI * R;
    return '<div class="ring"><svg viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="' + R + '"/><circle class="fg" cx="40" cy="40" r="' + R +
      '" style="stroke:' + color + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg><b>' + pct + '%</b></div>';
  }
  const bar = (pct, cls) => '<div class="bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';

  const stepFrac = (s, now) => {
    if (typeof s.frac === 'number') return Math.min(s.frac, 0.99);
    if (s.subs && s.subs.length) {
      const d = s.subs.filter((x) => x.status === 'done').length;
      const run = s.subs.find((x) => x.status === 'doing' && x.etaSeconds && x.etaSetAt);
      const part = run ? Math.min(0.95, (now - run.startedAt) / 1000 / Math.max(run.etaSeconds + (run.etaSetAt - run.startedAt) / 1000, 1)) : 0;
      return Math.min(0.99, (d + part) / s.subs.length);
    }
    if (s.etaSeconds && s.startedAt) {
      const total = (s.etaSetAt - s.startedAt) / 1000 + s.etaSeconds;
      return Math.min(0.95, (now - s.startedAt) / 1000 / Math.max(total, 1));
    }
    return 0;
  };
  function progress(r, now) {
    if (!r.steps.length) return null;
    if (r.status === 'done') return 100;
    const done = r.steps.filter((s) => s.status === 'done').length;
    const cur = r.steps.find((s) => s.status === 'doing');
    return Math.round(((done + (cur ? stepFrac(cur, now) : 0)) / r.steps.length) * 100);
  }
  const etaLeft = (o, now) => (o && o.etaSetAt && typeof o.etaSeconds === 'number' ? (o.etaSetAt + o.etaSeconds * 1000 - now) / 1000 : null);

  // Total time left for the whole run, counted the same way as lib/state.js runLeft (keep both in sync).
  // Claude's total ("eta TIME --total") is used while it still covers the steps left; otherwise the steps decide.
  function runLeftOf(r, cur, now) {
    const explicit = etaLeft(r, now);
    const fin = r.steps.filter((s) => s.status === 'done' && s.startedAt && s.endedAt);
    const avg = fin.length ? fin.reduce((a, s) => a + (s.endedAt - s.startedAt) / 1000, 0) / fin.length
      : cur && typeof cur.etaSeconds === 'number' && cur.etaSetAt && cur.startedAt ? (cur.etaSetAt - cur.startedAt) / 1000 + cur.etaSeconds : null;
    const unknown = { sec: explicit, source: explicit === null ? null : 'claude', explicit, computed: null };
    if (!cur && avg === null) return unknown; // nothing started or finished yet: no step-based number
    let curLeft = 0;
    if (cur) {
      const l = etaLeft(cur, now);
      if (l !== null) curLeft = Math.max(0, l);
      else if (avg !== null && cur.startedAt) curLeft = Math.max(0, avg - (now - cur.startedAt) / 1000);
      else return unknown;
    }
    let todoLeft = 0;
    for (const s of r.steps) {
      if (s.status !== 'todo') continue;
      const h = hist['step:' + r.title + '/' + s.title];
      const e = typeof s.etaSeconds === 'number' && s.etaSeconds > 0 ? s.etaSeconds : typeof h === 'number' && h > 0 ? h : avg;
      if (e === null) return unknown;
      todoLeft += e;
    }
    const computed = curLeft + todoLeft;
    if (explicit !== null && explicit > 0 && explicit >= computed - 5) return { sec: explicit, source: 'claude', explicit, computed };
    return { sec: computed, source: 'computed', explicit, computed };
  }

  // ---------- tiles ----------
  function tilesHtml(S, run, now) {
    const todos = S.todos || [];
    const tDone = todos.filter((t) => t.status === 'completed').length;
    const running = run && run.status === 'running';
    const cur = run && run.steps.find((s) => s.status === 'doing');
    let pct = run ? progress(run, now) : null;
    if (pct === null && todos.length) pct = Math.round((tDone / todos.length) * 100);
    const color = run && run.status === 'failed' ? 'var(--bad)' : run && run.status === 'done' ? 'var(--ok)' : 'var(--run)';
    const left = run ? runLeftOf(run, cur, now) : null;

    // 1: progress ring
    let t1 = '<div class="tile"><div class="k">Progress</div>' + (pct === null ? '<div class="v dim">—</div><div class="sub">nothing to measure yet</div>' :
      '<div class="ringwrap">' + ring(running ? smooth('run', pct) : pct, color) + '<div class="sub">' + (run ? esc(run.title) : plural(todos.length, 'task')) + '</div></div>') + '</div>';

    // 2: big ETA
    let t2 = '<div class="tile"><div class="k">Total left</div>';
    if (running && left && left.sec !== null) {
      const sec = left.sec;
      const how = sec <= 0 ? 'past the estimate, waiting for a new one' : left.source === 'claude' ? 'estimated, ticking down'
        : left.explicit !== null ? 'total not updated, calculated from the steps' : 'calculated from the steps';
      t2 += '<div class="v">' + (sec > 0 ? '~' + clock(sec) : 'over') + '</div><div class="sub">' + how + (run.etaFromHistory && left.source === 'claude' ? ' · from last run' : '') + '</div>';
    }
    else if (running) t2 += '<div class="v dim">—</div><div class="sub">no estimate yet</div>';
    else if (run && run.endedAt) t2 += '<div class="v">' + clock((run.endedAt - run.startedAt) / 1000) + '</div><div class="sub">total time' + (run.status === 'done' ? '' : ' before it ' + run.status) + '</div>';
    else t2 += '<div class="v dim">—</div><div class="sub">idle</div>';
    t2 += '</div>';

    // 3: "now" hero
    let cls = 'idle', head = 'Idle', body = 'Nothing is running. Ask Claude to run something.';
    const doing = todos.find((t) => t.status === 'in_progress');
    if (running) {
      cls = 'run'; head = 'Now';
      body = run.now || (cur && (cur.plain || cur.title)) || run.plain || 'Working…';
    } else if (run && run.status === 'done') { cls = 'ok'; head = 'Done'; body = run.summary || 'Finished successfully'; }
    else if (run && (run.status === 'failed' || run.status === 'stopped')) { cls = 'bad'; head = run.status === 'failed' ? 'Failed' : 'Stopped'; body = run.summary || run.status; }
    else if (doing) { cls = 'wait'; head = 'Claude is working on'; body = doing.activeForm || doing.content; }
    else if (todos.length && tDone === todos.length) { cls = 'ok'; head = 'All tasks done'; body = plural(todos.length, 'task') + ' completed'; }
    let t3 = '<div class="tile now ' + cls + '"><div class="k">' + head + '</div><div class="hero">' + esc(body) + '</div>' +
      (running && run.plain ? '<div class="sub">' + esc(run.plain) + '</div>' : '') + '</div>';

    // 4: counts
    const jobs = (run && run.jobs) || [];
    const live = run && run.live;
    const rows = [];
    if (run && run.steps.length) rows.push(['Steps', run.steps.filter((s) => s.status === 'done').length + ' / ' + run.steps.length]);
    if (todos.length) rows.push(['Tasks', tDone + ' / ' + todos.length]);
    if (jobs.length) rows.push(['Jobs', jobs.filter((j) => j.state === 'done').length + ' / ' + jobs.length]);
    if (live && (live.pass || live.fail)) rows.push(['Passed', '<span class="okc">' + num(live.pass) + '</span>'], ['Failed', '<span class="' + (live.fail ? 'badc' : '') + '">' + num(live.fail) + '</span>']);
    if (run) rows.push([running ? 'Running for' : 'Duration', clock(((run.endedAt || now) - run.startedAt) / 1000)]);
    const t4 = '<div class="tile"><div class="k">In numbers</div>' + (rows.length ? '<dl class="nums">' + rows.map((x) => '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>').join('') + '</dl>' : '<div class="v dim">—</div>') + '</div>';
    return '<div class="tiles">' + t1 + t2 + t3 + t4 + '</div>';
  }

  // ---------- freshness ----------
  // Warn when a part's estimate does not fit inside the bigger estimate that contains it.
  function estWarnHtml(run, now) {
    if (!run || run.status !== 'running') return '';
    const cur = run.steps.find((s) => s.status === 'doing');
    const total = etaLeft(run, now);
    const out = [];
    const fmt = (sec) => dur(Math.max(0, sec));
    const calc = runLeftOf(run, cur, now);
    const staleTotal = calc.source === 'computed' && calc.explicit !== null;
    if (staleTotal) out.push('The total time left is out of date: it says ' + fmt(calc.explicit) + ', but the steps still to do add up to ' + fmt(calc.computed) + '. The dashboard shows the number from the steps. Claude should set the total: eta TIME --total.');
    if (!staleTotal && total !== null && cur) {
      const sl = etaLeft(cur, now);
      if (sl !== null && sl > total + 5) out.push('Step "' + esc(cur.title) + '" is estimated at ' + fmt(sl) + ' but the whole job has only ' + fmt(total) + ' left.');
      const rest = run.steps.filter((s) => s.status === 'todo' && s.etaSeconds).reduce((a, s) => a + s.etaSeconds, 0);
      if (rest + Math.max(0, sl || 0) > total + 5 && rest > 0) out.push('The remaining steps add up to ' + fmt(rest + Math.max(0, sl || 0)) + ', more than the ' + fmt(total) + ' left in total.');
    }
    if (cur) {
      const sl = etaLeft(cur, now);
      const sub = (cur.subs || []).find((x) => x.status === 'doing' && x.etaSeconds && x.etaSetAt);
      const subLeft = sub ? etaLeft(sub, now) : null;
      if (sl !== null && subLeft !== null && subLeft > sl + 5) out.push('Sub-step "' + esc(sub.title) + '" needs ' + fmt(subLeft) + ', more than the ' + fmt(sl) + ' left for its step.');
      const subsSum = (cur.subs || []).filter((x) => x.status !== 'done' && x.etaSeconds).reduce((a, x) => a + x.etaSeconds, 0);
      if (sl !== null && subsSum > sl + 5) out.push('Sub-steps of "' + esc(cur.title) + '" add up to ' + fmt(subsSum) + ', more than the ' + fmt(sl) + ' left for the step.');
    }
    return out.length ? '<div class="banner"><b>Time estimates do not add up.</b> ' + out.join(' ') + ' Claude should fix the estimate.</div>' : '';
  }
  function freshHtml(run, now) { return estWarnHtml(run, now) + freshCore(run, now); }
  function freshCore(run, now) {
    if (!run || run.status !== 'running') return '';
    const idle = now - (run.lastActivityAt || run.startedAt);
    const silentMs = run.wrapped && run.lastOutputAt ? now - run.lastOutputAt : 0;
    if (run.wrapped && idle > 60000) return '<div class="banner bad"><b>Lost connection to the script ' + ago(idle) + '.</b> The window that started it may have been closed.</div>';
    if (run.wrapped && idle > 15000) return '<div class="banner"><b>No heartbeat for ' + dur(idle / 1000) + '.</b> The script may be busy or hanging.</div>';
    if (run.wrapped && run.lastOutputAt && silentMs > cfg.staleMinutes * 60000) return '<div class="banner"><b>Alive, but silent for ' + dur(silentMs / 1000) + '.</b> It may be a long operation, or it may be stuck.</div>';
    if (!run.wrapped && idle > cfg.staleMinutes * 60000) return '<div class="banner bad"><b>No update for ' + dur(idle / 1000) + '.</b> The script may be stuck, or Claude did not report (last update ' + hhmm(run.lastActivityAt || run.startedAt) + ').</div>';
    return '';
  }

  function subTime(x, now) {
    let t = '';
    if (x.status === 'done' && x.startedAt && x.endedAt && x.endedAt > x.startedAt) t = 'took ' + dur((x.endedAt - x.startedAt) / 1000);
    else if (x.status === 'doing') { const l = etaLeft(x, now); t = l === null ? (x.startedAt ? 'running ' + dur((now - x.startedAt) / 1000) : '') : l > 0 ? '~' + dur(l) + ' left' : 'past the estimate'; }
    else if (x.status === 'todo' && x.etaSeconds) t = '~' + dur(x.etaSeconds);
    return t ? '<span class="subt">' + t + '</span>' : '';
  }

  // ---------- pipeline (dynamic stages from the run) ----------
  function pipelineHtml(run, now) {
    if (!run || !run.steps.length) return '';
    const cards = run.steps.map((s, i) => {
      const mark = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'doing' ? '<span class="spin">◐</span>' : i + 1;
      let note = '';
      if (s.status === 'doing') {
        const left = etaLeft(s, now);
        note = bar(Math.round(stepFrac(s, now) * 100)) + '<div class="meta">' + (left === null ? 'running ' + dur((now - s.startedAt) / 1000) : left > 0 ? '~' + dur(left) + ' left' : 'past the estimate') + '</div>';
        if (s.subs && s.subs.length) note += '<ul class="subs">' + s.subs.map((x) => '<li class="' + x.status + '"><span>' + ({ done: '✓', doing: '▶', failed: '✗', todo: '·' }[x.status] || '·') + '</span><span>' + esc(x.title) + '</span>' + subTime(x, now) + '</li>').join('') + '</ul>';
      } else if (s.status === 'done' && s.startedAt && s.endedAt) note = '<div class="meta">took ' + dur((s.endedAt - s.startedAt) / 1000) + '</div>';
      else if (s.status === 'todo' && s.etaSeconds) note = '<div class="meta">~' + dur(s.etaSeconds) + '</div>';
      if (s.note) note += '<div class="meta">' + esc(s.note) + '</div>';
      return '<div class="stage ' + s.status + '"><span class="num">' + mark + '</span><div class="sb"><div class="t">' + esc(s.title) + '</div>' + (s.plain ? '<div class="d">' + esc(s.plain) + '</div>' : '') + note + '</div></div>';
    }).join('');
    return '<div class="sec"><h2>Pipeline</h2><div class="pipeline">' + cards + '</div></div>';
  }

  // ---------- activity ----------
  function activityHtml(S, run, now) {
    const items = (S.activity || []).slice(-14).reverse();
    let h = '<div class="card"><h3>What is happening</h3>';
    if (!items.length) return h + '<div class="muted">Live lines show up here as Claude or a script reports them.</div></div>';
    const lastAt = items[0].at;
    if (run && run.status === 'running' && now - lastAt > 300000) h += '<div class="banner"><b>Nothing new for ' + dur((now - lastAt) / 1000) + '.</b> It may be stuck.</div>';
    h += '<div class="act">' + items.map((a, i) => '<div class="ln' + (i === 0 ? ' first' : '') + (/^(FAILED|First failure|Failed)/.test(a.text) ? ' bad' : '') + '"><span class="ago">' + ago(now - a.at) + '</span><span>' + esc(a.text) + '</span></div>').join('') + '</div></div>';
    return h;
  }

  // "Write tests ~5m" -> text + estimate in seconds
  function splitEst(t) {
    const m = /\s*~\s*(\d+(?:\.\d+)?)\s*(s|m|h)\w*\s*$/i.exec(t || '');
    if (!m) return { text: t || '', est: null };
    return { text: t.slice(0, m.index), est: +m[1] * { s: 1, m: 60, h: 3600 }[m[2].toLowerCase()] };
  }
  function todoTime(t, est, now) {
    let x = '';
    if (t.status === 'completed') { if (t.startedAt && t.endedAt && t.endedAt - t.startedAt > 1500) x = 'took ' + dur((t.endedAt - t.startedAt) / 1000); }
    else if (t.status === 'in_progress' && est) { const left = est - (t.startedAt ? (now - t.startedAt) / 1000 : 0); x = left > 0 ? '~' + dur(left) + ' left' : 'past the estimate'; }
    else if (t.status === 'in_progress' && t.startedAt) x = 'running ' + dur((now - t.startedAt) / 1000);
    else if (est) x = '~' + dur(est);
    return x ? '<span class="tt">' + x + '</span>' : '';
  }

  // ---------- tasks ----------
  function tasksHtml(S, run, now) {
    const todos = S.todos || [];
    let h = '<div class="card"><h3>Claude\'s tasks</h3>';
    if (!todos.length) return h + '<div class="muted">No tasks yet. When Claude plans multi-step work, the list appears here.</div></div>';
    const done = todos.filter((t) => t.status === 'completed');
    const rest = todos.filter((t) => t.status !== 'completed');
    h += '<div class="tasksum"><b>' + done.length + ' of ' + todos.length + '</b> <span class="muted">completed</span></div>' + bar(Math.round((done.length / todos.length) * 100), 'ok');
    if (done.length) h += det('doneTasks') + '<summary>✓ ' + plural(done.length, 'task') + ' done</summary>' + done.map((t) => { const e = splitEst(t.content); return '<div class="todo completed"><span class="cb">✓</span><span class="tx">' + esc(e.text) + '</span>' + todoTime(t, e.est, now) + '</div>'; }).join('') + '</details>';
    h += rest.map((t) => {
      const doing = t.status === 'in_progress';
      const e = splitEst(t.content);
      return '<div class="todo ' + t.status + '"><span class="cb">' + (doing ? '<span class="spin">◐</span>' : '') + '</span><span class="tx">' + esc(doing && t.activeForm ? splitEst(t.activeForm).text : e.text) + '</span>' + todoTime(t, e.est, now) + '</div>';
    }).join('');
    return h + '</div>';
  }

  // ---------- jobs ----------
  function jobsHtml(run, now) {
    const jobs = (run && run.jobs) || [];
    if (!jobs.length) return '';
    const doneT = jobs.filter((x) => x.state === 'done' && x.took > 0).map((x) => x.took);
    const avgJob = doneT.length ? doneT.reduce((a, b) => a + b, 0) / doneT.length : null;
    const cards = jobs.map((j0) => {
      const j = Object.assign({}, j0);
      let guessed = false;
      if (j.state === 'run' && !j.estimate && avgJob) { j.estimate = avgJob; guessed = true; }
      const label = { todo: 'Waiting', run: 'Running', done: 'Done', fail: 'Failed' }[j.state] || j.state;
      let h = '<div class="job ' + j.state + '"><div class="jh"><span class="chip ' + j.state + '">' + label + '</span><span class="jn">' + esc(j.name) + '</span></div>';
      if (j.plain) h += '<div class="d">' + esc(j.plain) + '</div>';
      const el = j.state === 'run' ? (now - j.began) / 1000 : j.took;
      if (j.state === 'run') {
        const f = j.estimate ? Math.min(0.95, el / Math.max(j.estimate, 1)) : null;
        h += bar(f === null ? 100 : Math.round(f * 100), f === null ? 'indet' : '');
      } else if (j.state === 'done') h += bar(100, 'ok'); else if (j.state === 'fail') h += bar(100, 'bad');
      const meta = [];
      if (el !== undefined && el !== null) meta.push((j.state === 'run' ? 'running ' : 'took ') + dur(el));
      if (j.state === 'run' && j.estimate) { const l = j.estimate - el; meta.push(l > 0 ? '~' + dur(l) + ' left' + (guessed ? ' (avg of finished jobs)' : '') : 'past the estimate'); }
      else if (j.state === 'run') meta.push('<span class="muted">no estimate yet</span>');
      if (j.live && (j.live.pass || j.live.fail)) meta.push('<span class="okc">' + j.live.pass + ' passed</span>' + (j.live.fail ? ' · <span class="badc">' + j.live.fail + ' failed</span>' : ''));
      if (meta.length) h += '<div class="meta">' + meta.join(' · ') + '</div>';
      if (j.summary) h += '<div class="meta">' + esc(j.summary) + '</div>';
      if (j.live && j.live.last && j.live.last.length && j.state === 'run') h += '<pre class="tail">' + esc(j.live.last.slice(-3).join('\n')) + '</pre>';
      if (j.state === 'fail' && j.detail) h += '<pre class="tail bad">' + esc(j.detail) + '</pre>';
      return h + '</div>';
    }).join('');
    return '<div class="card"><h3>Running now' + ' <span class="muted">(' + jobs.filter((j) => j.state === 'run').length + ' active)</span></h3><div class="jobs">' + cards + '</div></div>';
  }

  // ---------- run output ----------
  function outputHtml(run) {
    if (!run) return '';
    const live = run.live || { pass: 0, fail: 0, last: [] };
    const lines = (live.last && live.last.length ? live.last : []).concat(run.lastLine && !(live.last || []).includes(run.lastLine) ? [run.lastLine] : []);
    if (!live.pass && !live.fail && !run.lastLine && !run.failDetail) return '';
    let h = '<div class="card"><h3>Output</h3>';
    if (live.pass || live.fail) h += '<div class="pf"><span class="okc"><b>' + num(live.pass) + '</b> passed</span><span class="' + (live.fail ? 'badc' : 'muted') + '"><b>' + num(live.fail) + '</b> failed</span></div>';
    if (lines.length) h += '<pre class="tail">' + esc(lines.slice(-6).join('\n')) + '</pre>';
    if (run.failDetail) h += '<div class="muted">What went wrong</div><pre class="tail bad">' + esc(run.failDetail) + '</pre>';
    return h + '</div>';
  }

  function contextHtml(c) {
    let h = '<div class="card"><h3>Claude\'s memory in this chat</h3>';
    if (!c) return h + '<div class="muted">Data appears after the next message.</div></div>';
    const color = c.percent >= 85 ? 'var(--bad)' : c.percent >= 60 ? 'var(--warn)' : 'var(--ok)';
    const hint = c.percent >= 95 ? 'Claude is about to compact the chat automatically (it summarizes and small details are forgotten).' : c.percent >= 85 ? 'Close to auto-compact. Consider summarizing or starting a new chat.' : c.percent >= 60 ? 'Filling up. Soon it is worth summarizing.' : 'Plenty of room.';
    const ac = c.acTokens ? 'Auto-compact is set to ' + num(c.acTokens) + ' tokens (your autoCompactWindow setting); the bar is full when it is reached.' : c.acPct && c.acPct < 100 ? 'Auto-compact triggers at ' + c.acPct + '% of the window (' + num(c.window) + ' tokens); the bar is full when it is reached.' : 'Auto-compact is off; the bar is full at the end of the window.';
    return h + '<div class="meter">' + ring(c.percent, color) + '<div><b>' + num(c.used) + '</b> <span class="muted">of ' + num(c.max) + ' tokens until compact</span><div class="muted">' + hint + '</div></div></div><div class="muted" style="margin-top:8px">' + ac + '</div></div>';
  }

  function resetDur(sec) {
    if (sec < 86400) return dur(sec);
    const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
    return plural(d, 'day') + (h ? ' ' + plural(h, 'hour') : '');
  }
  function usageHtml(u, now) {
    let h = '<div class="card"><h3>Claude usage limits</h3>';
    if (!u) return h + '<div class="muted">Loading…</div></div>';
    if (u.error) return h + '<div class="muted">' + (u.error === 'not-logged-in' ? 'Not signed in to Claude Code (subscription login needed).' : 'Could not read usage (' + esc(u.error) + ').') + '</div></div>';
    const row = (label, x) => {
      if (!x) return '';
      const p = Math.round(x.pct);
      const cls = p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok';
      const reset = x.resetsAt ? (x.resetsAt > now ? 'resets in ' + resetDur((x.resetsAt - now) / 1000) : 'resetting…') : '';
      return '<div class="urow"><div class="uh"><b>' + label + '</b><span>' + p + '%</span></div>' + bar(p, cls) + (reset ? '<div class="meta">' + reset + '</div>' : '') + '</div>';
    };
    const body = row('5-hour limit', u.fiveHour) + row('Weekly limit', u.weekly) + row('Weekly Opus', u.opus);
    return h + (body || '<div class="muted">No limits reported for this plan.</div>') + '</div>';
  }

  function historyHtml(runs, lastRun, now) {
    const older = runs.filter((r) => r !== lastRun).reverse();
    if (!older.length) return '';
    return '<div class="card">' + det('hist') + '<summary>Run history (' + older.length + ')</summary>' +
      older.map((r) => '<div class="hrow"><span class="chip ' + (r.status === 'done' ? 'done' : r.status === 'running' ? 'run' : 'fail') + '">' + ({ done: 'Done', failed: 'Failed', stopped: 'Stopped', running: 'Running' }[r.status]) + '</span> ' + esc(r.title) +
        '<div class="muted">' + hhmm(r.startedAt) + ' · ' + dur(((r.endedAt || now) - r.startedAt) / 1000) + (r.summary ? ' · ' + esc(r.summary) : '') + '</div></div>').join('') + '</details></div>';
  }

  function render() {
    const now = Date.now();
    const list = S ? sessionList(S) : [];
    const V = S ? view(S, list) : null;
    hist = (V && V.history) || {};
    const runs = (V && V.runs) || [];
    const active = [...runs].reverse().find((r) => r.status === 'running');
    const live = !!active || (S && now - S.updatedAt < 6000);
    let h = '<div class="top"><div class="logo"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" opacity=".4"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5 8.5 8.5 0 0 1-3.2 6.6"/><path d="M8.6 12.4l2.4 2.5 4.4-5.3"/></svg></div>' +
      '<div class="ttl"><h1>Claude Dashboard</h1><div class="muted">Live progress of Claude\'s work and your scripts</div></div>' +
      '<span class="pill ' + (live ? 'live' : '') + '"><i></i>' + (active ? 'Running' : live ? 'Active' : 'Idle') + '</span></div>';
    if (!S) {
      h += '<div class="card empty"><div class="big">📡</div><b>Waiting for data</b><div class="muted">Make sure the Claude plugin is installed, then send Claude a message in this folder.</div></div>';
    } else {
      const run = active || runs[runs.length - 1] || null;
      h += tabsHtml(list, V.curSession, now);
      if (V.goal && V.goal.text && /[\p{L}\p{N}]/u.test(V.goal.text)) h += '<div class="goal"><span class="gk">🎯 Goal</span><span class="gt">' + esc(V.goal.text) + '</span></div>';
      h += freshHtml(run, now) + tilesHtml(V, run, now) + pipelineHtml(run, now);
      h += '<div class="cols"><div class="col">' + activityHtml(V, run, now) + tasksHtml(V, run, now) + '</div>' +
        '<div class="col">' + jobsHtml(run, now) + outputHtml(run) + '</div>' +
        '<div class="col">' + usageHtml(usage, now) + contextHtml(V.context) + historyHtml(runs, run, now) + '</div></div>';
      h += '<div class="foot">Updated ' + hhmm(S.updatedAt) + '</div>';
    }
    if (h !== last) { last = h; app.innerHTML = h; }
  }
})();
