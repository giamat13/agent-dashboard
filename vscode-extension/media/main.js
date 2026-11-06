(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let S = null, cfg = { staleMinutes: 3 }, last = '', usage = null, hist = {}, gh = null, providers = null;
  let settings = null;             // the on/off settings from the extension (null until the first update)
  let settingsOpen = false;        // the gear popover
  let usageCompact = false;        // the usage card in its compact view (remembered for this viewer)
  let bigShot = null;              // the screenshot shown enlarged in its card (its time stamp), or null
  let fullShot = null;             // the screenshot shown over the whole dashboard (its time stamp), or null
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fullShot !== null) { fullShot = null; render(); } });
  const open = new Set();          // ids of <details> the user opened
  const shown = {};                // smoothed percentages (key -> value), so numbers glide instead of jumping

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') { S = e.data.state; cfg = e.data.cfg || cfg; usage = e.data.usage || null; providers = e.data.providers || null; settings = e.data.settings || settings; gh = e.data.gh || null; render(); }
  });
  vscode.postMessage({ type: 'ready' });
  setInterval(() => S && render(), 1000);
  app.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#hist > summary')) e.preventDefault(); // run history stays open
    if (e.target.closest && e.target.closest('[data-gear]')) { settingsOpen = !settingsOpen; render(); return; }
    if (settingsOpen && !(e.target.closest && e.target.closest('.pop'))) { settingsOpen = false; render(); } // a click outside closes it
    if (e.target.closest && e.target.closest('.fullshot')) { fullShot = null; render(); return; }
    const shot = e.target.closest && e.target.closest('.shots figure');
    if (shot) {
      const at = Number(shot.getAttribute('data-at'));
      if (settings && settings.screenshotsFullscreen === true) fullShot = at;
      else bigShot = bigShot === at ? null : at;
      render(); return;
    }
    if (e.target.closest && e.target.closest('[data-compact]')) {
      usageCompact = !usageCompact;
      try { vscode.setState(Object.assign({}, vscode.getState() || {}, { usageCompact })); } catch { /* ignore */ }
      render(); return;
    }
    const tab = e.target.closest && e.target.closest('[data-sid]');
    if (tab) { sel = tab.getAttribute('data-sid'); try { vscode.setState(Object.assign({}, vscode.getState() || {}, { sel })); } catch { /* ignore */ } render(); }
  });
  // A switch in the settings popover: keep it on screen at once, and tell the extension (it saves the file).
  app.addEventListener('change', (e) => {
    const k = e.target && e.target.getAttribute && e.target.getAttribute('data-set');
    if (!k || !settings) return;
    const v = !!e.target.checked;
    settings = Object.assign({}, settings, { [k]: v });
    vscode.postMessage({ type: 'setSettings', settings: { [k]: v } });
    render();
  });
  let sel = null;
  try { const saved = vscode.getState() || {}; sel = saved.sel || null; usageCompact = !!saved.usageCompact; } catch { /* ignore */ }

  // Sessions of this project (the state file is per project). Shown as tabs when there is more than one.
  function sessionList(S) {
    const now = Date.now();
    return Object.values(S.sessions || {}).filter((x) => now - (x.lastSeen || 0) < 3 * 3600e3).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }
  // "All sessions" tab: every session's tasks and every run, with the tasks grouped by session.
  const ALL = '__all';
  function view(S, list) {
    if (!list.length) return S;
    if (sel === ALL && list.length > 1) {
      const groups = list.map((x, i) => ({ id: x.id, agent: x.agent || 'claude', title: x.title || ('Session ' + (list.length - i)), goal: x.goal || null, context: x.context || null, todos: x.todos || [] }));
      return Object.assign({}, S, { todos: [].concat(...groups.map((g) => g.todos)), goal: null, context: null, curSession: ALL, groups, runs: S.runs || [], shots: [] });
    }
    const cur = list.find((x) => x.id === sel) || list.find((x) => x.id === S.session) || list[0];
    return Object.assign({}, S, {
      todos: cur.todos || [], goal: cur.goal || null, context: cur.context || null, curSession: cur.id, curAgent: cur.agent || 'claude', groups: null,
      runs: (S.runs || []).filter((r) => !r.session || r.session === cur.id),
      shots: cur.shots || [],   // only the pictures of this session
    });
  }
  // Icon of the agent that runs a session: Claude, Codex or GitHub Copilot (Claude when unknown).
  const AGENT_INFO = {
    claude: { name: 'Claude', color: '#d97757' },
    codex: { name: 'Codex', color: '#10a37f' },
    copilot: { name: 'GitHub Copilot', color: '#8957e5' },
    antigravity: { name: 'Antigravity', color: '#4285f4' },
  };
  function agentIcon(agent) {
    const a = AGENT_INFO[agent] ? agent : 'claude';
    const info = AGENT_INFO[a];
    const shape = a === 'codex'
      ? '<path d="M5 7l5 5-5 5M12 17h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
      : a === 'copilot'
        ? '<path d="M5.5 9.5c0-2.3 2.6-3.5 6.5-3.5s6.5 1.2 6.5 3.5v3c0 3.4-2.9 6-6.5 6s-6.5-2.6-6.5-6z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.2" cy="12.4" r="1.4" fill="currentColor"/><circle cx="14.8" cy="12.4" r="1.4" fill="currentColor"/>'
        : a === 'antigravity'
          ? '<path d="M4.5 19.5L12 4.5l7.5 15M7.6 14.5h8.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M12 3.5v17M4.6 7.7l14.8 8.6M4.6 16.3l14.8-8.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
    return '<svg viewBox="0 0 24 24" width="14" height="14" role="img" aria-label="' + info.name + '" style="color:' + info.color + ';vertical-align:-2px;margin-right:5px;flex:none"><title>' + info.name + '</title>' + shape + '</svg>';
  }
  function tabsHtml(list, curId, now) {
    if (list.length < 2) return '';
    const busyAny = list.some((x) => (x.todos || []).some((t) => t.status === 'in_progress'));
    const all = '<button data-sid="' + ALL + '" class="stab' + (curId === ALL ? ' on' : '') + '" title="Show every session together">' + (busyAny ? '<i></i>' : '') +
      'All sessions <span class="muted">' + list.length + '</span></button>';
    return '<div class="stabs">' + all + list.map((x, i) => {
      const busy = (x.todos || []).some((t) => t.status === 'in_progress');
      return '<button data-sid="' + esc(x.id) + '" class="stab' + (x.id === curId ? ' on' : '') + '" title="' + esc(x.title || x.id) + '">' + (busy ? '<i></i>' : '') +
        agentIcon(x.agent) + esc(x.title || ('Session ' + (list.length - i))) + ' <span class="muted">' + (now - (x.lastSeen || 0) < 60000 ? 'now' : hhmm(x.lastSeen)) + '</span></button>';
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
  // plan (optional): { width } = the planned share, drawn as a striped part right after the used part of the bar.
  const bar = (pct, cls, plan) => {
    const p = Math.max(0, Math.min(100, pct));
    const seg = plan && plan.width > 0 ? '<i class="u" style="left:' + p + '%;width:' + Math.min(100 - p, plan.width) + '%"></i>' : '';
    return '<div class="bar ' + (cls || '') + '"><i style="width:' + p + '%"></i>' + seg + '</div>';
  };

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
    // The whole task: when there is a TODO list, its done items count, and the item in progress counts with the progress of
    // the running script (if any). Without a TODO list, the progress of the run's steps.
    let pct = run ? progress(run, now) : null;
    if (todos.length) {
      const running1 = todos.find((t) => t.status === 'in_progress');
      const share = running1 && pct !== null ? pct / 100 : 0;
      pct = Math.round(((tDone + share) / todos.length) * 100);
    }
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
    if (!items.length) return '';
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
  // One list of tasks: the finished ones fold away under a summary line, the rest show first.
  function taskRows(todos, now, key) {
    const done = todos.filter((t) => t.status === 'completed');
    const rest = todos.filter((t) => t.status !== 'completed');
    let h = '';
    if (done.length) h += det('doneTasks' + key) + '<summary>✓ ' + plural(done.length, 'task') + ' done</summary>' + done.map((t) => { const e = splitEst(t.content); return '<div class="todo completed"><span class="cb">✓</span><span class="tx">' + esc(e.text) + '</span>' + todoTime(t, e.est, now) + '</div>'; }).join('') + '</details>';
    h += rest.map((t) => {
      const doing = t.status === 'in_progress';
      const e = splitEst(t.content);
      return '<div class="todo ' + t.status + '"><span class="cb">' + (doing ? '<span class="spin">◐</span>' : '') + '</span><span class="tx">' + esc(doing && t.activeForm ? splitEst(t.activeForm).text : e.text) + '</span>' + todoTime(t, e.est, now) + '</div>';
    }).join('');
    return h;
  }
  // "All sessions": the tasks are grouped by session, with that session's goal under its name.
  function tasksHtml(V, run, now) {
    const todos = V.todos || [];
    const groups = V.groups;
    let h = '<div class="card"><h3>' + (groups ? 'Agent tasks (all sessions)' : agentIcon(V.curAgent) + 'Agent tasks') + '</h3>';
    if (!todos.length) return '';
    const done = todos.filter((t) => t.status === 'completed');
    h += '<div class="tasksum"><b>' + done.length + ' of ' + todos.length + '</b> <span class="muted">completed</span></div>' + bar(Math.round((done.length / todos.length) * 100), 'ok');
    if (!groups) return h + taskRows(todos, now, '') + '</div>';
    groups.forEach((g, i) => {
      if (!g.todos.length) return;
      const gDone = g.todos.filter((t) => t.status === 'completed').length;
      h += '<div class="grp"><div class="grph">' + agentIcon(g.agent) + esc(g.title) + ' <span class="muted">' + gDone + ' of ' + g.todos.length + '</span></div>' +
        (g.goal && g.goal.text ? '<div class="muted grpg">🎯 ' + esc(g.goal.text) + '</div>' : '') + taskRows(g.todos, now, 'g' + i) + '</div>';
    });
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

  // ---------- GitHub Actions ----------
  // The runs of this repository, read by the extension with the GitHub CLI (lib/gh.js). GitHub Pages deploys go in a small line at the bottom.
  const GH_ERRORS = {
    'gh-missing': 'Install the GitHub CLI (gh) to see your runs here.',
    'not-logged-in': 'Not logged in to GitHub. Run: gh auth login',
    'no-remote': 'This folder has no GitHub remote.',
    'offline': 'GitHub cannot be reached right now. Trying again later.',
    'failed': 'Could not read the runs. Trying again later.',
  };
  const GH_MARK = { success: ['✓', 'ok'], failure: ['✗', 'bad'], cancelled: ['–', 'muted'] };
  // Seconds left for a running run: its estimate minus the time since it started. null when there is no estimate.
  function ghLeftSec(r, now) {
    if (!r.estimateSec || !r.startedAt) return null;
    return r.estimateSec - (now - Date.parse(r.startedAt)) / 1000;
  }
  function ghPagesHtml(p, now) {
    if (!p) return '';
    const text = p.status !== 'completed'
      ? 'GitHub Pages: ' + (p.status === 'queued' ? 'queued' : 'deploying') + '…'
      : 'GitHub Pages: ' + (p.conclusion === 'success' ? 'deployed' : p.conclusion === 'failure' ? 'deploy failed' : esc(p.conclusion || 'finished')) +
        (p.at ? ' · ' + ago(now - Date.parse(p.at)) : '');
    return '<div class="ghpages">' + text + '</div>';
  }
  function ghHtml(gh, now) {
    if (!gh || gh.error === 'off') return '';
    let h = '<div class="card gh"><h3>GitHub Actions' + (gh.repo ? ' <span class="muted">' + esc(gh.repo) + '</span>' : '') + '</h3>';
    if (gh.error) return h + '<div class="muted">' + esc(GH_ERRORS[gh.error] || GH_ERRORS.failed) + '</div></div>';
    if (!gh.running.length && !gh.recent.length && !gh.pages) return '';
    if (!gh.running.length) h += '<div class="muted">Nothing running.</div>';
    h += gh.running.map((r) => {
      const queued = r.status === 'queued';
      const el = r.startedAt ? (now - Date.parse(r.startedAt)) / 1000 : null;
      const left = ghLeftSec(r, now);
      const f = left === null || el === null ? null : Math.min(0.95, el / Math.max(r.estimateSec, 1));
      const meta = [];
      if (el !== null) meta.push((queued ? 'queued ' : 'running ') + dur(Math.max(0, el)));
      if (left === null) meta.push('<span class="muted">no estimate yet</span>');
      else meta.push(left > 0 ? '~' + dur(left) + ' left' : 'past the estimate');
      if (r.estimateFrom === 'claude') meta.push('<span class="muted">Claude\'s estimate</span>');
      else if (r.estimateFrom === 'history') meta.push('<span class="muted">usual time</span>');
      return '<div class="job ' + (queued ? 'todo' : 'run') + '"><div class="jh"><span class="chip ' + (queued ? 'todo' : 'run') + '">' + (queued ? 'Queued' : 'Running') +
        '</span><span class="jn">' + esc(r.workflow || 'Workflow') + '</span></div>' +
        '<div class="d">' + esc(r.title) + (r.branch ? ' <span class="muted">on ' + esc(r.branch) + '</span>' : '') + '</div>' +
        bar(f === null ? 100 : Math.round(f * 100), f === null ? 'indet' : '') + '<div class="meta">' + meta.join(' · ') + '</div></div>';
    }).join('');
    if (gh.recent.length) {
      h += '<div class="muted ghlabel">Recent</div>' + gh.recent.map((r) => {
        const mark = GH_MARK[r.conclusion] || ['•', 'muted'];
        return '<div class="ghrow"><span class="gc ' + mark[1] + '">' + mark[0] + '</span><span class="gt">' + esc(r.title) + '</span><span class="muted">' +
          esc(r.workflow) + ' · ' + dur(r.durationSec || 0) + (r.endedAt ? ' · ' + ago(now - Date.parse(r.endedAt)) : '') + '</span></div>';
      }).join('');
    }
    return h + ghPagesHtml(gh.pages, now) + '</div>';
  }

  // ---------- screenshots Claude read ----------
  // Only with the "showScreenshots" switch on. The pictures are copies in <project>/.agent-dashboard/shots (see hook.js captureShot).
  function shotsHtml(S, now) {
    const shots = ((S && S.shots) || []).filter((s) => s && s.src);
    if (!settings || settings.showScreenshots !== true || !shots.length) return '';
    return '<div class="card"><h3>Screenshots Claude read</h3><div class="shots">' + shots.slice().reverse().map((s) =>
      '<figure class="' + (s.at === bigShot ? 'big' : '') + '" data-at="' + esc(String(s.at || 0)) + '"><img src="' + esc(s.src) + '" alt="' + esc(s.name || 'screenshot') + '" loading="lazy"><figcaption>' + esc(s.name || '') + ' · ' + ago(now - (s.at || now)) + '</figcaption></figure>').join('') + '</div></div>';
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

  function contextHtml(c, sessionId) {
    let h = '<div class="card"><div class="cardh"><h3>Agent memory in this chat</h3></div>';
    if (!c) return '';
    const color = c.percent >= 85 ? 'var(--bad)' : c.percent >= 60 ? 'var(--warn)' : 'var(--ok)';
    const hint = c.percent >= 95 ? 'Claude is about to compact the chat automatically (it summarizes and small details are forgotten).' : c.percent >= 85 ? 'Close to auto-compact. Consider summarizing or starting a new chat.' : c.percent >= 60 ? 'Filling up. Soon it is worth summarizing.' : 'Plenty of room.';
    const ac = c.acTokens ? 'Auto-compact is set to ' + num(c.acTokens) + ' tokens (your autoCompactWindow setting); the bar is full when it is reached.' : c.acPct && c.acPct < 100 ? 'Auto-compact triggers at ' + c.acPct + '% of the window (' + num(c.window) + ' tokens); the bar is full when it is reached.' : 'Auto-compact is off; the bar is full at the end of the window.';
    return h + '<div class="meter">' + ring(c.percent, color) + '<div><b>' + num(c.used) + '</b> <span class="muted">of ' + num(c.max) + ' tokens until compact</span><div class="muted">' + hint + '</div></div></div><div class="muted" style="margin-top:8px">' + ac + '</div></div>';
  }

  // "All sessions": each chat's memory, one bar per chat.
  function allContextHtml(groups) {
    const h = '<div class="card"><h3>Agent memory in each chat</h3>';
    const withCtx = groups.filter((g) => g.context && typeof g.context.percent === 'number');
    if (!withCtx.length) return '';
    return h + withCtx.map((g) => {
      const p = Math.round(g.context.percent);
      return '<div class="urow"><div class="uh"><b>' + agentIcon(g.agent) + esc(g.title) + '</b><span>' + p + '%</span></div>' +
        bar(p, p >= 85 ? 'bad' : p >= 60 ? 'warn' : 'ok') + '<div class="muted">' + num(g.context.used || 0) + ' of ' + num(g.context.max || 0) + ' tokens until compact</div></div>';
    }).join('') + '</div>';
  }
  // "All sessions": runs still going in the other sessions, so none hides behind the one shown.
  function otherRunsHtml(V, run, now) {
    if (!V.groups) return '';
    const others = (V.runs || []).filter((r) => r !== run && r.status === 'running');
    if (!others.length) return '';
    return '<div class="others">' + others.map((r) => {
      const g = V.groups.find((x) => x.id === r.session);
      const cur = (r.steps || []).find((s) => s.status === 'doing');
      const p = progress(r, now);
      const left = runLeftOf(r, cur, now);
      const eta = left.sec === null ? 'no estimate yet' : left.sec > 0 ? '~' + clock(left.sec) + ' left' : 'past the estimate';
      return '<div class="other"><span class="chip run">' + esc(g ? g.title : 'Other') + '</span><b>' + esc(r.title) + '</b>' +
        (p === null ? '' : '<span class="muted">' + p + '%</span>') + '<span class="muted">' + eta + '</span></div>';
    }).join('') + '</div>';
  }

  function resetDur(sec) {
    if (sec < 86400) return dur(sec);
    const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
    return plural(d, 'day') + (h ? ' ' + plural(h, 'hour') : '');
  }
  // The planned share of one limit for the whole task in progress: what similar tasks used, minus what it has used so far.
  // Returns the width of the striped part (percent) and its text. null when this task has no usage numbers.
  function planInfo(t, key, u) {
    const start = t.start, est = t.est, x = u && u[key];
    if (!start || typeof start[key] !== 'number' || !x || typeof x.pct !== 'number') return null;
    if (!est || typeof est[key] !== 'number') return { width: 0, text: 'no data yet' };
    const n = est.n || 0;
    const what = est.kind === 'average' ? 'average of ' + n + (n === 1 ? ' task' : ' tasks') : n + (n === 1 ? ' similar task' : ' similar tasks');
    const model = est.sameModel === false ? 'other model' : esc(String(est.model || ''));
    // The text is the expected share of the limit when the task reaches 100%: where it started, plus the estimate.
    // The striped part runs from the current share up to that same point, so the bar and the text always agree
    // (also when the limit reset during the task and the current share is below where it started).
    const at100 = Math.min(100, start[key] + est[key]);
    const width = Math.max(0, at100 - x.pct);
    return { width, text:'planned at 100%: ~' + Math.round(at100) + '% (' + what + (model ? ', ' + model : '') + ')' + (start.stale ? ', limits read earlier' : '') };
  }
  // The whole task that is open and has usage numbers, the newest one (of this session or any other session).
  function plannedOf(state) {
    if (!state) return null;
    let best = null;
    const tasks = [state.usageTask].concat(Object.values(state.sessions || {}).map((x) => x && x.usageTask));
    for (const t of tasks) {
      if (!t || !t.start) continue;
      if (!best || (t.start.at || 0) > (best.start.at || 0)) best = t;
    }
    return best;
  }
  // A card with nothing to show is left out (no empty cards). The COMPACT button switches the card between its two views.
  function usageHtml(u, now, task, showPlan, compact) {
    if (!u) return '';
    const h = '<div class="card"><div class="cardh"><h3>Claude usage limits</h3><button class="cmp" data-compact aria-pressed="' + (compact ? 'true' : 'false') + '">' + (compact ? 'Full' : 'Compact') + '</button></div>';
    if (u.error) return h +'<div class="muted">' + (u.error === 'not-logged-in' ? 'Not signed in to Claude Code (subscription login needed).' : u.error === 'rate-limited' ? 'Anthropic is limiting usage checks for a few minutes. The numbers appear by themselves at the next check.' : 'Usage is not available right now. It is checked again automatically.') + '</div></div>';
    const row = (label, key, x) => {
      if (!x) return '';
      const p = Math.round(x.pct);
      const cls = p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok';
      const reset = x.resetsAt ? (x.resetsAt > now ? 'resets in ' + resetDur((x.resetsAt - now) / 1000) : 'resetting…') : '';
      const pl = showPlan && task ? planInfo(task, key, u) : null;
      const meta = [reset, pl ? pl.text : ''].filter(Boolean).join(' · ');
      if (compact) return '<div class="urow compact"><div class="uh"><b>' + label + '</b><span>' + p + '%' + (reset ? ' <span class="muted">· ' + reset + '</span>' : '') + '</span></div>' + bar(p, cls, pl) + '</div>';
      return '<div class="urow"><div class="uh"><b>' + label + '</b><span>' + p + '%</span></div>' + bar(p, cls, pl) + (meta ? '<div class="meta">' + meta + '</div>' : '') + '</div>';
    };
    const body = row('5-hour limit', 'fiveHour', u.fiveHour) + row('Weekly limit', 'weekly', u.weekly) + row('Weekly Opus', 'opus', u.opus);
    return body ? h + body + '</div>' : '';
  }

  // Codex and GitHub Copilot, Pro plans only (lib/providers.js). A card is shown only when it has a limit to show,
  // so a free plan shows nothing here.
  function providerRow(label, x, now) {
    const p = Math.round(x.pct);
    const cls = p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok';
    const reset = x.resetsAt ? (x.resetsAt > now ? 'resets in ' + resetDur((x.resetsAt - now) / 1000) : 'resetting…') : '';
    return '<div class="urow"><div class="uh"><b>' + label + '</b><span>' + p + '%</span></div>' + bar(p, cls, null) + (reset ? '<div class="meta">' + reset + '</div>' : '') + '</div>';
  }
  function providersHtml(p, now) {
    if (!p) return '';
    let h = '';
    const cx = p.codex;
    if (cx && (cx.fiveHour || cx.weekly)) {
      h += '<div class="card"><h3>Codex usage limits</h3>' +
        (cx.fiveHour ? providerRow('5-hour limit', cx.fiveHour, now) : '') +
        (cx.weekly ? providerRow('Weekly limit', cx.weekly, now) : '') + '</div>';
    }
    const cp = p.copilot;
    if (cp && cp.premium) h += '<div class="card"><h3>GitHub Copilot usage limits</h3>' + providerRow('Premium requests', cp.premium, now) + '</div>';
    return h;
  }

  function historyHtml(runs, lastRun, now, groups) {
    const older = runs.filter((r) => r !== lastRun).reverse();
    if (!older.length) return '';
    const sessionOf = (r) => { const g = groups && groups.find((x) => x.id === r.session); return g ? ' · ' + esc(g.title) : ''; };
    return '<div class="card"><details id="hist" open><summary>Run history (' + older.length + ')</summary>' +
      older.map((r) => '<div class="hrow"><span class="chip ' + (r.status === 'done' ? 'done' : r.status === 'running' ? 'run' : 'fail') + '">' + ({ done: 'Done', failed: 'Failed', stopped: 'Stopped', running: 'Running' }[r.status]) + '</span> ' + esc(r.title) +
        '<div class="muted">' + hhmm(r.startedAt) + ' · ' + dur(((r.endedAt || now) - r.startedAt) / 1000) + sessionOf(r) + (r.summary ? ' · ' + esc(r.summary) : '') + '</div></div>').join('') + '</details></div>';
  }

  // Settings popover (opened by the gear in the header). Each switch is saved for this computer.
  const SETTING_ROWS = [
    ['usageEstimate', 'Planned usage on the limit bars', 'Shows how much of a limit the similar tasks are expected to use.'],
    ['usageRecord', 'Remember usage for each task', 'Records how much of a limit each finished task used, for future estimates.'],
    ['localApi', 'Local API', 'Lets other tools read this dashboard. This computer only.'],
    ['extensionAutoUpdate', 'Update this extension by itself', 'Checks GitHub Releases about once an hour.'],
    ['pluginAutoUpdate', 'Update the Claude plugin by itself', 'Checks about once a day when Claude starts a session.'],
    ['showScreenshots', 'Show screenshots Claude reads', 'When Claude reads a PNG or JPG file, the picture appears here. Copies stay in .agent-dashboard in this project, never in git.'],
    ['screenshotsFullscreen', 'Screenshots full screen', 'A click on a screenshot opens it over the whole dashboard. Click or press Esc to close it.'],
    ['showActivity', 'Activity card', 'The live list of what happened in this project.'],
    ['showTasks', 'Agent tasks card', 'The to-do list of each Claude session.'],
    ['showJobs', 'Parallel jobs card', 'Jobs that run at the same time.'],
    ['showContext', 'Agent memory card', 'What Claude has in its context, and how full it is.'],
    ['showUsage', 'Claude usage limits card', 'The 5-hour and weekly limits of Claude.'],
    ['showProviders', 'Codex and Copilot limits card', 'The limits of Codex and GitHub Copilot, for paid plans.'],
    ['showHistory', 'Run history card', 'The runs that finished earlier.'],
    ['showOutput', 'Output card', 'The last lines a build or test printed, with the pass and fail counts.'],
  ];
  function settingsHtml() {
    if (!settingsOpen || !settings) return '';
    return '<div class="pop" role="dialog" aria-label="Settings"><div class="poph"><b>Settings</b><span class="muted">saved on this computer</span></div>' +
      SETTING_ROWS.map(([k, t, d]) => '<label class="prow"><input type="checkbox" data-set="' + k + '"' + (settings[k] !== false ? ' checked' : '') +
        '><span><b>' + t + '</b><span class="muted">' + d + '</span></span></label>').join('') + '</div>';
  }

  // A card's switch: the saved value, or the default before the settings arrive.
  const isOn = (k, dflt) => (settings && typeof settings[k] === 'boolean' ? settings[k] : dflt);

  function render() {
    const now = Date.now();
    const list = S ? sessionList(S) : [];
    const V = S ? view(S, list) : null;
    hist = (V && V.history) || {};
    const runs = (V && V.runs) || [];
    const active = [...runs].reverse().find((r) => r.status === 'running');
    const live = !!active || (S && now - S.updatedAt < 6000);
    let h = '<div class="top"><div class="logo"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" opacity=".4"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5 8.5 8.5 0 0 1-3.2 6.6"/><path d="M8.6 12.4l2.4 2.5 4.4-5.3"/></svg></div>' +
      '<div class="ttl"><h1>Agent Dashboard</h1><div class="muted">Live progress of your agents\' work and your scripts</div></div>' +
      '<span class="pill ' + (live ? 'live' : '') + '"><i></i>' + (active ? 'Running' : live ? 'Active' : 'Idle') + '</span>' +
      '<button class="gear" data-gear title="Settings" aria-label="Settings" aria-expanded="' + (settingsOpen ? 'true' : 'false') + '">⚙</button>' + settingsHtml() + '</div>';
    if (!S) {
      h += '<div class="card empty"><div class="big">📡</div><b>Waiting for data</b><div class="muted">Make sure the Claude plugin is installed, then send Claude a message in this folder.</div></div>';
    } else {
      const run = active || runs[runs.length - 1] || null;
      h += tabsHtml(list, V.curSession, now);
      if (V.goal && V.goal.text && /[\p{L}\p{N}]/u.test(V.goal.text)) h += '<div class="goal"><span class="gk">🎯 Goal</span><span class="gt">' + esc(V.goal.text) + '</span></div>';
      h += freshHtml(run, now) + tilesHtml(V, run, now) + otherRunsHtml(V, run, now) + pipelineHtml(run, now);
      h += '<div class="cols"><div class="col">' + (isOn('showActivity', true) ? activityHtml(V, run, now) : '') + shotsHtml(V, now) + (isOn('showTasks', true) ? tasksHtml(V, run, now) : '') + '</div>' +
        '<div class="col">' + (isOn('showJobs', true) ? jobsHtml(run, now) : '') + (isOn('showOutput', false) ? outputHtml(run) : '') + '</div>' +
        '<div class="col">' + (isOn('showUsage', true) ? usageHtml(usage, now, plannedOf(S), !settings || settings.usageEstimate !== false, usageCompact) : '') + (isOn('showProviders', true) ? providersHtml(providers, now) : '') + (isOn('showContext', true) ? (V.groups ? allContextHtml(V.groups) : contextHtml(V.context, V.curSession)) : '') + (isOn('showHistory', true) ? historyHtml(runs, run, now, V.groups) : '') + '</div></div>';
      h += '<div class="foot">Updated ' + hhmm(S.updatedAt) + '</div>';
    }
    if (S && fullShot !== null) {
      const f = ((V && V.shots) || []).find((s) => s && s.src && s.at === fullShot);
      if (f) h += '<div class="fullshot" title="Click or press Esc to close"><img src="' + esc(f.src) + '" alt="' + esc(f.name || 'screenshot') + '"></div>';
    }
    if (h !== last) { last = h; app.innerHTML = h; }
  }
})();
