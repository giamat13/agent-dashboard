// Tests for the local usage log (lib/insights.js), the hook's cheap defaults, and "todo done" starting the next item.
// Run: node tests/insights.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-insights-'));
process.env.AGENT_DASH_HOME = tmp;
const I = require('../claude-plugin/scripts/lib/insights');
const SCRIPTS = path.join(__dirname, '..', 'claude-plugin', 'scripts');

try {
  // Kinds: a call made only for the dashboard is "dash"; dash.js joined to real work is "dash+work".
  assert.strictEqual(I.kindOf('Bash', { command: 'node "x/dash.js" todo done 1' }), 'dash');
  assert.strictEqual(I.kindOf('Bash', { command: 'cd /p && node x/dash.js now "a"' }), 'dash');
  assert.strictEqual(I.kindOf('Bash', { command: 'node x/dash.js todo done 1 && npm test' }), 'dash+work');
  assert.strictEqual(I.kindOf('Bash', { command: 'node x/wrap.js -- npm test' }), 'wrap');
  assert.strictEqual(I.kindOf('Bash', { command: 'git status' }), 'shell');
  assert.strictEqual(I.kindOf('TodoWrite', {}), 'todo-tool');
  assert.strictEqual(I.kindOf('Read', { file_path: 'C:/t/tasks/abc.output' }), 'read-bg-output');
  assert.strictEqual(I.labelOf('Bash', { command: 'cd /p && git log' }), 'git');
  assert.strictEqual(I.labelOf('Read', { file_path: '/secret/place/a.js' }), '.js', 'no paths in the log');
  console.log('ok - kinds and labels');

  // Turn usage from a transcript: the calls since the last real user message, each message id once.
  const tr = path.join(tmp, 't.jsonl');
  const asst = (id, cr) => JSON.stringify({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: 1, cache_read_input_tokens: cr, cache_creation_input_tokens: 10, output_tokens: 5 } } });
  fs.writeFileSync(tr, [
    JSON.stringify({ type: 'user', message: { content: 'old prompt' } }), asst('a0', 999),
    JSON.stringify({ type: 'user', message: { content: 'new prompt' } }), asst('a1', 100), asst('a1', 100),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), asst('a2', 200),
  ].join('\n') + '\n');
  const u = I.turnUsage(tr);
  assert.deepStrictEqual([u.calls, u.cacheRead, u.output, u.maxCtx], [2, 300, 10, 211]);
  console.log('ok - turn usage');

  // The hook: no reminders by default, but the log fills, with no command text in it.
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: project, AGENT_DASH_HOME: tmp, USERPROFILE: tmp, HOME: tmp });
  const hook = (input) => spawnSync(process.execPath, [path.join(SCRIPTS, 'hook.js')], { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 30000 });
  let r = hook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: project, prompt: 'Fix the bug', transcript_path: tr });
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
  assert.ok(!/^Dashboard:/m.test(ctx) && /Planned usage/.test(ctx), 'no task reminder by default, only the planned-usage line');
  assert.ok(ctx.length < 300, 'only the short planned-usage line: ' + ctx.length);
  for (let i = 0; i < 7; i++) {
    r = hook({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: project, tool_name: 'Bash', tool_input: { command: 'npm run secret-thing' }, tool_response: 'ok', transcript_path: tr });
    assert.strictEqual(r.stdout, '', 'no TODO reminder by default');
  }
  r = hook({ hook_event_name: 'Stop', session_id: 's1', cwd: project, transcript_path: tr });
  const log = fs.readFileSync(I.file(), 'utf8');
  assert.ok(!log.includes('secret-thing') && !log.includes('Fix the bug'), 'no command or prompt text in the log');
  const recs = I.readAll();
  assert.strictEqual(recs.filter((x) => x.ev === 'tool').length, 7);
  assert.strictEqual(recs.filter((x) => x.ev === 'turn').length, 1);
  const rep = I.report(0, { claudeGuide: true, todoReminders: false });
  assert.ok(/1 turns, 2 model calls/.test(rep) && /shell 7/.test(rep) && /todoReminders=off/.test(rep), rep);
  console.log('ok - hook: cheap defaults, and a log without prompt or command text');

  // The switch turns the log off.
  fs.writeFileSync(path.join(tmp, '.agent-dashboard', 'settings.json'), JSON.stringify({ usageInsights: false, todoReminders: true }));
  const before = I.readAll().length;
  let nudged = false;
  for (let i = 0; i < 7; i++) {
    r = hook({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: project, tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' });
    if (r.stdout) nudged = true;
  }
  assert.strictEqual(I.readAll().length, before, 'usageInsights off: nothing logged');
  console.log('ok - the usageInsights switch; todoReminders on ' + (nudged ? 'reminds' : 'has no open TODOs to remind about'));

  // "todo done" starts the next item, so one command does the work of two.
  const dash = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'dash.js'), ...a], { env, encoding: 'utf8', cwd: project });
  dash('todo', 'set', '[~] a|b|c');
  r = dash('todo', 'done', '1');
  assert.strictEqual(r.stdout.trim(), 'TODO 1/3 done, now 2', r.stdout + r.stderr);
  console.log('ok - todo done starts the next item');

  r = dash('insights');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/Usage log/.test(r.stdout));
  console.log('ok - dash.js insights');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('all insights tests passed');
