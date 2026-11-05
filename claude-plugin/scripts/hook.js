#!/usr/bin/env node
'use strict';
// Hook אחד לכל האירועים: מסנכרן TODO והקשר ללוח, ומזכיר ל-Claude לעדכן שלבים וזמן משוער.
const fs = require('fs');
const path = require('path');
const S = require('./lib/state');

const DASH = path.join(__dirname, 'dash.js').replace(/\\/g, '/');
const STALE_ETA_MS = 2 * 60 * 1000;
const REMIND_EVERY_MS = 60 * 1000;
const LONG_CMD = /\b(test|tests|pytest|jest|vitest|mocha|playwright|cypress|e2e|build|compile|migrate|benchmark|install|train|lint|tsc)\b|\.(sh|ps1|bat)\b|npm run|pnpm|yarn|gradle|mvn|cargo|go test|dotnet/i;

let raw = '';
process.stdin.on('data', (d) => (raw += d)).on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { /* ignore */ }
  try { main(inp); } catch { /* hooks must never break Claude */ }
  process.exit(0);
});

function emit(event, text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
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
function stampTodos(todos, prev, now) {
  const old = new Map((prev || []).map((t) => [todoKey(t), t]));
  (todos || []).forEach((t) => {
    const o = old.get(todoKey(t)) || {};
    if (t.status === 'in_progress') t.startedAt = o.startedAt && o.status === 'in_progress' ? o.startedAt : now;
    else if (t.status === 'completed') { t.startedAt = o.startedAt; t.endedAt = o.endedAt && o.status === 'completed' ? o.endedAt : now; }
  });
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

const GUIDE =`Agent Dashboard is ON: the user watches a live progress dashboard inside VS Code (TODOs, context, long-running scripts).
FULLY AUTONOMOUS: never wait to be told. Update it continuously, end every TODO item with an estimate ("item ~5m"), and split every step into small sub-steps YOURSELF, each with its own estimate (--subs "a~2m|b~90s"), then sub start/done as you go.
PREFERRED for real scripts: wrap the command so the dashboard is live and automatic (heartbeat, last output line, auto % and ETA from the output, exit code):
  node "${DASH.replace('dash.js', 'wrap.js')}" --title "<title>" --plain "<plain sentence>" --steps "step1::plain|step2::plain" -- <the real command>
(run that wrapper command itself in the background). The script may also print lines "@@step 2", "@@sub done", "@@now <text>", "@@eta 5m", "@@job start|done|fail <name>" to drive the dashboard. Stages are always dynamic: name them yourself per project (--steps, or @@step <new name> adds one on the fly). Parallel things: node "${DASH}" job start <name> --eta 3m (ALWAYS give --eta, otherwise the card shows no time left) | job done|fail <name>. Live line: node "${DASH}" log "<text>". User goal (/goal) is shown automatically; set manually with node "${DASH}" goal "<text>".
Otherwise (manual reporting) for EVERY build, test, install, migration, packaging step or script (do not judge whether it is short or long; only bare ls/pwd/echo/cat/git status|log|diff and file reads are exempt) report progress with:
  node "${DASH}" run start "<title>" --plain "<one plain sentence a non-technical person understands>" --steps "step1::plain explanation|step2::plain explanation" --eta 20m
  node "${DASH}" step start <n|name> --plain "<what is happening, simple words>" --eta 4m --subs "sub1~2m|sub2~90s|sub3~30s"   # every sub-step gets its own estimate after ~
  node "${DASH}" sub done [n|all]      # finish a sub-step
  node "${DASH}" now "<what is happening right now, simple words, with counts like '33 of 36 done' or '45%': the progress bar follows them>"
  node "${DASH}" eta 6m                # ESTIMATE FROM NOW for the current step. Update it EVERY time you check on the script.
  node "${DASH}" step done | step fail "<reason>" ; node "${DASH}" run done|fail --summary "<result in plain words>"
Run the long command in the background, then check its output every 1-2 minutes and update the dashboard (step/sub/now/eta) each time.
Write all dashboard texts in English, in simple words, no jargon (the user may not be technical). TODOs sync automatically from TodoWrite. If you have NO TodoWrite/TaskCreate tool in this session, you MUST still keep the user's TODO list yourself, for any task with 2+ steps: at the start run node "${DASH}" todo set "[~] current item|next item|another item" ; as you progress run node "${DASH}" todo done <n> / todo doing <n> / todo add "new item" (items marked [x]=done, [~]=in progress). Run these in the background like any command.`;

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
  const ss = st.sessions[sid] || (st.sessions[sid] = { id: sid, firstSeen: now, todos: [], context: null, goal: null });
  const prevTodos = (ss.todos || []).map((t) => Object.assign({}, t));
  st.todos = ss.todos || []; st.goal = ss.goal || null; st.context = ss.context || null; st.todoSync = ss.todoSync;
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
  } else if (event === 'UserPromptSubmit' && typeof inp.prompt === 'string' && !inp.prompt.trim().startsWith('/') &&
             !(st.todos || []).some((t) => t.status !== 'completed')) {
    out = `Agent Dashboard is ON and the user is watching it. If this task has 2+ steps, FIRST create the TODO list (TodoWrite/TaskCreate; if you have neither: node "${DASH}" todo set "[~] current|next|another"), keep it updated as you go (in_progress when starting a step, completed right after), and wrap EVERY build/test/install/script command with wrap.js (or report it with dash.js run/step/now); do not judge by duration. Dashboard texts in simple English.`;
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
      } else if (run && !run.wrapped) {
        const step = run.steps.find((s) => s.status === 'doing');
        const o = step || run;
        const etaAge = o.etaSetAt ? now - o.etaSetAt : Infinity;
        const idle = now - (run.lastActivityAt || run.startedAt);
        if (etaAge > STALE_ETA_MS || idle > STALE_ETA_MS) {
          out = `Dashboard reminder: run "${run.title}" is active but the user has no fresh update (${Math.round(idle / 60000)} min). Now update it: node "${DASH}" now "<what is happening, simple words>" ; node "${DASH}" eta <time left>${step ? '' : ' ; node "' + DASH + '" step start <n> --eta <time>'} ; node "${DASH}" sub done. Do this each time you check the script.`;
        }
      }
      if (out) st.lastReminderAt = now;
    }
  }

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
  stampTodos(st.todos, prevTodos, now);
  Object.assign(ss, { todos: st.todos, goal: st.goal, context: st.context, todoSync: st.todoSync, lastSeen: now, cwd: inp.cwd, transcript: inp.transcript_path || ss.transcript });
  for (const k of Object.keys(st.sessions)) {
    const x = st.sessions[k];
    if (k === sid) continue;
    const gone = x.transcript && !fs.existsSync(x.transcript);   // archived or deleted sessions
    if (gone || now - (x.lastSeen || 0) > 6 * 3600e3) delete st.sessions[k];
  }
  S.save(root, st);
  if (out) emit(event, out);
}
