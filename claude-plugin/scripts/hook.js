#!/usr/bin/env node
'use strict';
// Hook אחד לכל האירועים: מסנכרן TODO והקשר ללוח, ומזכיר ל-Claude לעדכן שלבים וזמן משוער.
const fs = require('fs');
const path = require('path');
const S = require('./lib/state');
const USAGE = require('./lib/usage');
const Settings = require('./lib/settings');
const PluginUpdate = require('./lib/plugin-update');
const Agents = require('./lib/agents');

// "--agent codex|copilot --event <Event>": the other coding agents. Without it the hook serves Claude Code, as before.
const { agent: AGENT, event: EVENT_ARG } = Agents.parseArgs(process.argv);
const OFF_USAGE = { usageEstimate: false, usageRecord: false };   // the Claude plan limits belong to Claude sessions only

const DASH = path.join(__dirname, 'dash.js').replace(/\\/g, '/');
const STALE_ETA_MS = 2 * 60 * 1000;
const REMIND_EVERY_MS = 60 * 1000;
const LONG_CMD = /\b(test|tests|pytest|jest|vitest|mocha|playwright|cypress|e2e|build|compile|migrate|benchmark|install|train|lint|tsc)\b|\.(sh|ps1|bat)\b|npm run|pnpm|yarn|gradle|mvn|cargo|go test|dotnet/i;

let raw = '';
process.stdin.on('data', (d) => (raw += d)).on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { /* ignore */ }
  try { main(Agents.normalize(AGENT, inp, EVENT_ARG)); } catch { /* hooks must never break the agent */ }
  process.exit(0);
});

function emit(event, text) {
  const s = Agents.output(AGENT, event, text);
  if (s) process.stdout.write(s);
}

// The "autoCompactWindow" setting (absolute tokens) wins: per-model first, then global.
// Checked in project-local, project, then user settings.
function readAutoCompactTokens(cwd, model) {
  const os = require('os');
  const files = [
    path.join(cwd || '', '.claude', 'settings.local.json'),
    path.join(cwd || '', '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const perModel = j.modelSettings && j.modelSettings[model] && j.modelSettings[model].autoCompactWindow;
      const v = Number(perModel || j.autoCompactWindow);
      if (v > 0) return v;
    } catch { /* ignore */ }
  }
  return 0;
}

// Fallback: percent of the window at which Claude Code auto-compacts (default 85).
function readAutoCompactPct(cwd) {
  const os = require('os');
  const files = [
    path.join(cwd || '', '.claude', 'settings.local.json'),
    path.join(cwd || '', '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  let pct = parseFloat(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || '');
  for (const f of files) {
    if (pct) break;
    try {
      const v = parseFloat((JSON.parse(fs.readFileSync(f, 'utf8')).env || {}).CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
      if (v) pct = v;
    } catch { /* ignore */ }
  }
  let enabled = true;
  try { if (JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).autoCompactEnabled === false) enabled = false; } catch { /* ignore */ }
  if (!enabled) return 100;
  return pct > 0 && pct <= 100 ? pct : 85;
}

function readContext(transcript, cwd) {
  if (!transcript) return null;
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 400 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      const u = o.message && o.message.usage;
      if (!u || o.isSidechain || o.type !== 'assistant') continue;
      const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      const model = o.message.model || '';
      let max = parseInt(process.env.AGENT_DASH_CONTEXT_MAX || '', 10);
      if (!max) max = /1m/i.test(model) || used > 200000 ? 1000000 : 200000;
      const acTokens = readAutoCompactTokens(cwd, model);
      if (acTokens && acTokens > max) max = acTokens; // the user's auto-compact setting is the real ceiling
      const acPct = acTokens ? Math.round((acTokens / max) * 100) : readAutoCompactPct(cwd);
      const limit = acTokens ? acTokens : Math.round((max * acPct) / 100); // full bar = the moment auto-compact runs
      return { used, window: max, max: limit, acPct, acTokens, percent: Math.min(100, Math.round((used / limit) * 100)), model, updatedAt: Date.now() };
    }
  } catch { /* ignore */ }
  return null;
}

// Remember when each task started/finished (matched by text without the "~5m" estimate).
const todoKey = (t) => String(t.content || '').replace(/\s*~\s*\d+(?:\.\d+)?\s*(?:s|m|h)\w*\s*$/i, '').trim();
function stampTodos(st, todos, prev, now, cfg) {
  const old = new Map((prev || []).map((t) => [todoKey(t), t]));
  (todos || []).forEach((t) => {
    const o = old.get(todoKey(t)) || {};
    if (t.status === 'in_progress') t.startedAt = o.startedAt && o.status === 'in_progress' ? o.startedAt : now;
    else if (t.status === 'completed') { t.startedAt = o.startedAt; t.endedAt = o.endedAt && o.status === 'completed' ? o.endedAt : now; }
  });
  // Plan usage covers the whole list (the task), not one item: see lib/usage.js trackTask.
  USAGE.trackTask(st, todos, now, cfg);
}

function syncTodos(st, inp) {
  const name = inp.tool_name;
  const ti = inp.tool_input || {};
  if (name === 'TodoWrite' && Array.isArray(ti.todos)) {
    st.todos = ti.todos.map((t, i) => ({ id: String(i + 1), content: t.content, activeForm: t.activeForm || '', status: t.status }));
  } else if (name === 'TaskCreate') {
    const m = /#?(\d+)/.exec(typeof inp.tool_response === 'string' ? inp.tool_response : JSON.stringify(inp.tool_response || ''));
    st.todos.push({ id: m ? m[1] : String(st.todos.length + 1), content: ti.subject || ti.content || '', activeForm: ti.activeForm || '', status: 'pending' });
  } else if (name === 'TaskUpdate') {
    const t = st.todos.find((x) => x.id === String(ti.taskId));
    if (t) {
      if (ti.status === 'deleted') st.todos = st.todos.filter((x) => x !== t);
      else {
        if (ti.status) t.status = ti.status;
        if (ti.subject) t.content = ti.subject;
        if (ti.activeForm) t.activeForm = ti.activeForm;
      }
    }
  }
}

// מקור האמת ל-TODO: משחזרים מתמליל השיחה את כל הקריאות ל-TodoWrite/TaskCreate/TaskUpdate,
// כך שזה עובד בכל גרסה של Claude Code וגם אם הרשימה נוצרה לפני התקנת התוסף.
function syncTodosFromTranscript(st, transcript) {
  if (!transcript) return;
  let size;
  try { size = fs.statSync(transcript).size; } catch { return; }
  if (st.todoSync && st.todoSync.file === transcript && st.todoSync.size === size) return;
  let todos = null, counter = 0, tasks = [], goal;
  for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
    if (!/"(TodoWrite|TaskCreate|TaskUpdate)"|command-name>\s*\/?goal\s*</.test(line)) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text || '').join('\n') : '';
      const g = parseGoal(txt);
      if (g !== undefined) goal = g;
    }
    const parts = o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const p of parts) {
      if (p.type !== 'tool_use') continue;
      const ti = p.input || {};
      if (p.name === 'TodoWrite' && Array.isArray(ti.todos)) {
        todos = ti.todos.map((t, i) => ({ id: String(i + 1), content: t.content, activeForm: t.activeForm || '', status: t.status }));
        tasks = [];
        counter = 0;
      } else if (p.name === 'TaskCreate') {
        counter++;
        tasks.push({ id: String(counter), content: ti.subject || ti.content || '', activeForm: ti.activeForm || '', status: 'pending' });
        todos = tasks;
      } else if (p.name === 'TaskUpdate') {
        const t = tasks.find((x) => x.id === String(ti.taskId));
        if (t) {
          if (ti.status === 'deleted') tasks = tasks.filter((x) => x !== t);
          else {
            if (ti.status) t.status = ti.status;
            if (ti.subject) t.content = ti.subject;
            if (ti.activeForm) t.activeForm = ti.activeForm;
          }
          todos = tasks;
        }
      }
    }
  }
  st.todoSync = { file: transcript, size };
  if (todos) st.todos = todos;
  if (goal !== undefined) st.goal = goal;   // null = the user cleared it
}

// "/goal <text>" (also as <command-name>/goal</command-name><command-args>text</command-args>).
// Returns the goal text, null when cleared, undefined when the text is not a /goal command.
function parseGoal(txt) {
  let text = null;
  const m = /<command-name>\s*\/?goal\s*<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/.exec(txt);
  if (m) text = m[1];
  else if (/<command-name>\s*\/?goal\s*<\/command-name>/.test(txt)) text = '';
  else { const p = /^\s*\/goal(?:\s+([\s\S]*))?$/.exec(txt); if (p) text = p[1] || ''; }
  if (text === null) return undefined;
  text = text.trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text) || /^(clear|off|none|reset)$/i.test(text)) return null;
  return { text: text.slice(0, 500), at: Date.now() };
}

// The instructions for this agent (Claude, Codex or Copilot). Built in lib/agents.js.
const GUIDE = Agents.guideText(__dirname, AGENT);

// Screenshots: when Claude reads a picture (PNG, JPG, ...), a copy goes to <project>/.agent-dashboard/shots so the dashboard
// can show it. Only with the "showScreenshots" switch on. The folder is ignored by git (.agent-dashboard/.gitignore).
const SHOT_EXT = /\.(png|jpe?g|gif|webp)$/i;
const SHOT_MAX_BYTES = 5 * 1024 * 1024;
const SHOTS_KEEP = 6;
function captureShot(st, root, inp, now) {
  const given = String((inp.tool_input && inp.tool_input.file_path) || '');
  if (!SHOT_EXT.test(given) || !Settings.read().showScreenshots) return;
  const src = path.resolve(inp.cwd || root, given);
  try {
    const stat = fs.statSync(src);
    if (!stat.isFile() || stat.size > SHOT_MAX_BYTES) return;
  } catch { return; }
  const name = path.basename(src);
  const dir = path.join(root, '.agent-dashboard', 'shots');
  const copy = now + '-' + name.replace(/[^\w.-]+/g, '_');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, copy));
  } catch { return; }
  st.shots = (st.shots || []).concat([{ file: 'shots/' + copy, name, at: now }]);
  for (const old of st.shots.splice(0, Math.max(0, st.shots.length - SHOTS_KEEP))) {
    try { fs.unlinkSync(path.join(root, '.agent-dashboard', old.file)); } catch { /* already gone */ }
  }
  S.logActivity(st, 'Claude read the picture ' + name, now);
}

function main(inp) {
  const event = inp.hook_event_name;
  const root = S.findRoot(inp.cwd);
  const st = S.load(root);
  const now = Date.now();
  // Multi-session: each Claude session in this project keeps its own todos/goal/context.
  const sid = inp.session_id || 'default';
  st.sessions = st.sessions || {};
  if (event === 'SessionEnd') { // closed / archived session: drop it from the dashboard
    delete st.sessions[sid];
    const left = Object.values(st.sessions).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))[0];
    if (st.session === sid) st.session = left ? left.id : '';
    S.save(root, st);
    return;
  }
  const ss = st.sessions[sid] || (st.sessions[sid] = { id: sid, agent: AGENT, firstSeen: now, todos: [], context: null, goal: null });
  if (!ss.agent) ss.agent = AGENT;
  const prevTodos = (ss.todos || []).map((t) => Object.assign({}, t));
  st.todos = ss.todos || []; st.goal = ss.goal || null; st.context = ss.context || null; st.todoSync = ss.todoSync;
  st.usageTask = ss.usageTask || null;   // the planned task of this session (lib/usage.js)
  st.shots = ss.shots || [];             // the pictures this session read (captureShot), never the other sessions'
  const ctx = readContext(inp.transcript_path, inp.cwd);
  if (ctx) st.context = ctx;
  st.session = sid;
  const todoTool = /^(TodoWrite|TaskCreate|TaskUpdate)$/.test(inp.tool_name || '');
  if (event !== 'PreToolUse' && (event !== 'PostToolUse' || todoTool)) {
    try { syncTodosFromTranscript(st, inp.transcript_path); } catch { /* ignore */ }
  }
  let out = '';
  if (event === 'UserPromptSubmit' && typeof inp.prompt === 'string') {
    const g = parseGoal(inp.prompt);
    if (g !== undefined) { st.goal = g; if (g) S.logActivity(st, 'Goal set: ' + g.text.slice(0, 120), now); }
  }

  if (event === 'SessionStart') {
    out = GUIDE;
    if (AGENT === 'claude') {   // the Claude plugin's own update check: only for Claude sessions
      try {
        const notice = PluginUpdate.sessionStart();   // at most one background plugin update a day; the notice is shown once
        if (notice) out += '\n\n' + notice;
      } catch { /* the update check never breaks the session */ }
    }
  } else if (event === 'UserPromptSubmit' && typeof inp.prompt === 'string' && !inp.prompt.trim().startsWith('/') &&
             !(st.todos || []).some((t) => t.status !== 'completed')) {
    out = `Agent Dashboard is ON and the user is watching it. If this task has 2+ steps, FIRST create the TODO list (${AGENT === 'claude' ? 'TodoWrite/TaskCreate; if you have neither: ' : ''}node "${DASH}" todo set "[~] current|next|another"), keep it updated as you go (mark a step in_progress BEFORE you start its work, and completed the moment it is done; one in_progress at a time; the planned usage covers the WHOLE list, from its first in_progress item until every item is completed), and wrap EVERY build/test/install/script command with wrap.js (or report it with dash.js run/step/now); several tests in one run = one sub-step per test (--subs); do not judge by duration. Dashboard texts in simple English.`;
  } else if (event === 'PostToolUse' && /^(TodoWrite|TaskCreate|TaskUpdate)$/.test(inp.tool_name || '')) {
    syncTodos(st, inp);
  } else if (event === 'PreToolUse' || event === 'PostToolUse') {
    const isShell = /^(Bash|PowerShell)$/.test(inp.tool_name || '');
    const cmd = String((inp.tool_input && inp.tool_input.command) || '');
    const run = S.activeRun(st);
    const throttled = now - (st.lastReminderAt || 0) < REMIND_EVERY_MS;
    if (!throttled && !cmd.includes('dash.js')) {
      if (event === 'PreToolUse' && isShell && LONG_CMD.test(cmd) && !run) {
        out = `Dashboard reminder: this command looks long-running/a test. BEFORE running it, start a dashboard run with steps and ETA:\n${GUIDE}`;
      } else if (run && S.runLeft(run, now, st.history).source === 'computed' && S.runLeft(run, now, st.history).explicit !== null) {
        const info = S.runLeft(run, now, st.history);
        out = `Dashboard reminder: the total time left of run "${run.title}" is out of date (it says ${Math.round(Math.max(0, info.explicit) / 60)} min, the steps still to do add up to ${Math.round(info.computed / 60)} min). Fix it now: node "${DASH}" eta <time left for the WHOLE run> --total`;
      } else if (run && !run.wrapped) {
        const step = run.steps.find((s) => s.status === 'doing');
        const o = step || run;
        const etaAge = o.etaSetAt ? now - o.etaSetAt : Infinity;
        const idle = now - (run.lastActivityAt || run.startedAt);
        if (etaAge > STALE_ETA_MS || idle > STALE_ETA_MS) {
          out = `Dashboard reminder: run "${run.title}" is active but the user has no fresh update (${Math.round(idle / 60000)} min). Now update it: node "${DASH}" now "<what is happening, simple words>" ; node "${DASH}" eta <time left>${step ? '' : ' ; node "' + DASH + '" step start <n> --eta <time>'} ; node "${DASH}" sub done ; node "${DASH}" eta <time left for the WHOLE run> --total. Do this each time you check the script.`;
        }
      }
      if (out) st.lastReminderAt = now;
    }
  }

  if (event === 'PostToolUse' && inp.tool_name === 'Read') captureShot(st, root, inp, now);

  // Nudge: open tasks exist but the list has not been touched for several tool calls.
  if (event === 'PostToolUse') {
    if (todoTool || /dash\.js[^\n]*todo/.test(String((inp.tool_input && inp.tool_input.command) || ''))) ss.sinceTodo = 0;
    else ss.sinceTodo = (ss.sinceTodo || 0) + 1;
    const open = (st.todos || []).filter((t) => t.status !== 'completed');
    if (!out && open.length && ss.sinceTodo >= 5 && now - (ss.todoNudgeAt || 0) > 60000) {
      const cur = open.find((t) => t.status === 'in_progress') || open[0];
      out = `Dashboard reminder: your TODO list has not been updated for ${ss.sinceTodo} tool calls. If "${String(cur.content || cur.subject || cur.text || '').slice(0, 80)}" or any other step is finished, mark it completed now and mark the next one in_progress (TodoWrite/TaskUpdate, or: node "${DASH}" todo done <n> / todo doing <n>). Also add steps you discovered. Keep it truthful; do not mention this reminder to the user.`;
      ss.sinceTodo = 0; ss.todoNudgeAt = now;
    }
  }

  if (!ss.title && event === 'UserPromptSubmit' && typeof inp.prompt === 'string' && !inp.prompt.trim().startsWith('/')) ss.title = inp.prompt.trim().replace(/\s+/g, ' ').slice(0, 40);
  stampTodos(st, st.todos, prevTodos, now, AGENT === 'claude' ? Settings.read() : OFF_USAGE);
  Object.assign(ss, { todos: st.todos, goal: st.goal, context: st.context, todoSync: st.todoSync, usageTask: st.usageTask, shots: st.shots, lastSeen: now, cwd: inp.cwd, transcript: inp.transcript_path || ss.transcript });
  for (const k of Object.keys(st.sessions)) {
    const x = st.sessions[k];
    if (k === sid) continue;
    const gone = x.transcript && !fs.existsSync(x.transcript);   // archived or deleted sessions
    if (gone || now - (x.lastSeen || 0) > 6 * 3600e3) delete st.sessions[k];
  }
  S.save(root, st);
  emit(event, out);   // output() decides: Claude and the others print nothing, Antigravity always gets a JSON answer
}
