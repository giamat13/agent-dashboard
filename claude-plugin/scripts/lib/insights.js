'use strict';
// A local usage log: what costs Claude usage while the dashboard runs, so the dashboard can be made cheaper later.
// File: ~/.agent-dashboard/usage-insights.jsonl (a hidden folder in the home folder). Nothing here is ever sent anywhere:
// no network code reads it. It holds no prompt text, no file paths and no command text, only counts, sizes and kinds.
// Turn it off with the "usageInsights" setting. "dash.js insights" prints a short report of it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 3 * 1024 * 1024;   // then the file moves to usage-insights.old.jsonl and a new one starts
const home = () => process.env.AGENT_DASH_HOME || os.homedir();
const file = () => path.join(home(), '.agent-dashboard', 'usage-insights.jsonl');

function append(rec) {
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > MAX_BYTES) fs.renameSync(f, f.replace(/\.jsonl$/, '.old.jsonl')); } catch { /* no file yet */ }
    fs.appendFileSync(f, JSON.stringify(Object.assign({ t: Date.now() }, rec)) + '\n');
  } catch { /* the log never breaks a hook */ }
}

// What kind of tool call this was, for the cost report. "dash" = a call made only to update the dashboard (the costly kind).
function kindOf(tool, input) {
  if (/^(TodoWrite|TaskCreate|TaskUpdate)$/.test(tool)) return 'todo-tool';
  const cmd = String((input && input.command) || '');
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const hasDash = /dash\.js/.test(cmd), hasWrap = /wrap\.js/.test(cmd);
    if (hasWrap) return 'wrap';
    if (hasDash) {
      const rest = cmd.split(/&&|\|\||;|\n/).map((x) => x.trim()).filter((x) => x && !/dash\.js/.test(x) && !/^(cd|Set-Location)\b/.test(x));
      return rest.length ? 'dash+work' : 'dash';
    }
    return 'shell';
  }
  if (tool === 'Read' && /[\\/]tasks[\\/][^\\/]+\.output$/.test(String((input && input.file_path) || ''))) return 'read-bg-output';
  return 'other';
}

// A short, path-free label: the program a command runs, or the type of a file that was read.
function labelOf(tool, input) {
  const i = input || {};
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const parts = String(i.command || '').split(/&&|\|\||;|\n/).map((x) => x.trim()).filter((x) => x && !/^(cd|Set-Location)\b/.test(x));
    const w = (parts[0] || '').split(/\s+/)[0] || '';
    return path.basename(w.replace(/["']/g, '')).slice(0, 20);
  }
  if (i.file_path) return (path.extname(String(i.file_path)) || 'file').slice(0, 10);
  return '';
}

const sizeOf = (v) => (v === undefined || v === null ? 0 : typeof v === 'string' ? v.length : JSON.stringify(v).length);

// The token use of the turn that just ended: every model call since the last real user message, from the transcript.
function turnUsage(transcript) {
  if (!transcript) return null;
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    const seen = new Set();
    const sum = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, maxCtx: 0, model: '' };
    for (let k = lines.length - 1; k >= 0; k--) {
      let o;
      try { o = JSON.parse(lines[k]); } catch { continue; }
      if (o.isSidechain) continue;
      if (o.type === 'user' && o.message) {
        const c = o.message.content;
        const real = typeof c === 'string' ? !c.startsWith('<') : Array.isArray(c) && c.some((p) => p.type === 'text') && !c.some((p) => p.type === 'tool_result');
        if (real) break;
        continue;
      }
      const u = o.type === 'assistant' && o.message && o.message.usage;
      if (!u) continue;
      const id = o.message.id || o.uuid;
      if (seen.has(id)) continue;
      seen.add(id);
      sum.calls++;
      sum.input += u.input_tokens || 0;
      sum.cacheRead += u.cache_read_input_tokens || 0;
      sum.cacheWrite += u.cache_creation_input_tokens || 0;
      sum.output += u.output_tokens || 0;
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx > sum.maxCtx) sum.maxCtx = ctx;
      if (!sum.model) sum.model = o.message.model || '';
    }
    return sum.calls ? sum : null;
  } catch { return null; }
}

function readAll(sinceMs) {
  const out = [];
  for (const f of [file().replace(/\.jsonl$/, '.old.jsonl'), file()]) {
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) {
      if (!line) continue;
      try { const o = JSON.parse(line); if (!sinceMs || o.t >= sinceMs) out.push(o); } catch { /* skip a broken line */ }
    }
  }
  return out;
}

const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const pc = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');

// A short report (a few hundred tokens) so a later chat can see what costs usage without reading the raw log.
function report(days, settings) {
  const since = days ? Date.now() - days * 864e5 : 0;
  const all = readAll(since);
  if (!all.length) return 'No usage log yet (' + file() + '). It fills while you work with the dashboard on.';
  const turns = all.filter((r) => r.ev === 'turn');
  const tools = all.filter((r) => r.ev === 'tool');
  const inj = all.filter((r) => r.ev === 'inject');
  const sessions = new Set(all.map((r) => r.s)).size;
  const T = turns.reduce((a, r) => { a.calls += r.calls || 0; a.cr += r.cr || 0; a.cw += r.cw || 0; a.in += r.in || 0; a.out += r.out || 0; return a; }, { calls: 0, cr: 0, cw: 0, in: 0, out: 0 });
  const L = [];
  const first = new Date(Math.min(...all.map((r) => r.t))).toISOString().slice(0, 10);
  L.push('Usage log ' + first + ' to now: ' + sessions + ' sessions, ' + turns.length + ' turns, ' + T.calls + ' model calls (' + (turns.length ? (T.calls / turns.length).toFixed(1) : 0) + ' per turn).');
  L.push('Tokens: cache read ' + k(T.cr) + ', cache write ' + k(T.cw) + ', new input ' + k(T.in) + ', output ' + k(T.out) + '. Avg context per call ' + k(T.calls ? Math.round((T.cr + T.cw + T.in) / T.calls) : 0) + '.');
  // Each tool call costs one more model call that re-reads the whole context: ctx = the context of the call that made it.
  const byKind = {};
  for (const r of tools) { const x = byKind[r.kind] || (byKind[r.kind] = { n: 0, ctx: 0 }); x.n++; x.ctx += r.ctx || 0; }
  const totCtx = tools.reduce((a, r) => a + (r.ctx || 0), 0);
  L.push('Tool calls by kind (count, context tokens re-read): ' + Object.entries(byKind).sort((a, b) => b[1].ctx - a[1].ctx).map(([kd, x]) => kd + ' ' + x.n + ' (' + k(x.ctx) + ', ' + pc(x.ctx, totCtx) + ')').join(' · '));
  const byLabel = {};
  for (const r of tools) { const key = r.tool + (r.label ? ':' + r.label : ''); const x = byLabel[key] || (byLabel[key] = { n: 0, out: 0, max: 0 }); x.n++; x.out += r.out || 0; x.max = Math.max(x.max, r.out || 0); }
  L.push('Most used: ' + Object.entries(byLabel).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([kk, x]) => kk + ' ' + x.n).join(' · '));
  L.push('Biggest outputs (total chars, max): ' + Object.entries(byLabel).sort((a, b) => b[1].out - a[1].out).slice(0, 6).map(([kk, x]) => kk + ' ' + k(x.out) + '/' + k(x.max)).join(' · '));
  const byWhat = {};
  for (const r of inj) { const x = byWhat[r.what] || (byWhat[r.what] = { n: 0, chars: 0 }); x.n++; x.chars += r.chars || 0; }
  L.push('Text the hooks added to Claude\'s context (count, chars): ' + (Object.keys(byWhat).length ? Object.entries(byWhat).map(([w, x]) => w + ' ' + x.n + ' (' + k(x.chars) + ')').join(' · ') : 'none'));
  const dashOnly = byKind.dash || { n: 0, ctx: 0 };
  const hints = [];
  if (dashOnly.n && dashOnly.ctx / Math.max(1, totCtx) > 0.03) hints.push('calls made only for the dashboard are ' + pc(dashOnly.ctx, totCtx) + ' of the re-read context: make the hooks do more, or turn off more instructions');
  const polls = byKind['read-bg-output'];
  if (polls && polls.n > tools.length * 0.1) hints.push('many reads of background output files (' + polls.n + '): wait for the finish notice instead');
  if (hints.length) L.push('Hints: ' + hints.join('; ') + '.');
  if (settings) L.push('Switches now: ' + Object.entries(settings).filter(([kk]) => /^(claudeGuide|detailedUpdates|taskReminder|todoReminders|runReminders|claudeUsageEstimate|usageInsights)$/.test(kk)).map(([kk, v]) => kk + '=' + (v ? 'on' : 'off')).join(' '));
  L.push('Log file: ' + file());
  return L.join('\n');
}

module.exports = { file, append, kindOf, labelOf, sizeOf, turnUsage, readAll, report };
