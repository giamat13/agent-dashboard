// Tests for the Codex and Copilot hooks (claude-plugin/scripts/lib/agents.js) and hook.js run with "--agent".
// Run: node tests/agents.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const A = require('../claude-plugin/scripts/lib/agents');
const S = require('../claude-plugin/scripts/lib/state');
const SCRIPTS = path.join(__dirname, '..', 'claude-plugin', 'scripts');
const HOOK = path.join(SCRIPTS, 'hook.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-agents-'));

try {
  // Arguments: the agent and the event; Claude when the agent is missing or unknown.
  assert.deepStrictEqual(A.parseArgs(['node', 'hook.js']), { agent: 'claude', event: '' });
  assert.deepStrictEqual(A.parseArgs(['node', 'hook.js', '--agent', 'Codex', '--event', 'SessionStart']), { agent: 'codex', event: 'SessionStart' });
  assert.strictEqual(A.parseArgs(['node', 'hook.js', '--agent', 'vim']).agent, 'claude');
  console.log('ok - arguments: the agent and the event, Claude by default');

  // Claude input passes through unchanged.
  const claudeIn = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, transcript_path: '/t.jsonl' };
  assert.strictEqual(A.normalize('claude', claudeIn, ''), claudeIn);
  console.log('ok - Claude input passes through');

  // Codex: the event from the command line when the input has none, a command list becomes text, the transcript is not read.
  let n = A.normalize('codex', { session_id: 'x', transcript_path: '/r.jsonl', tool_input: { command: ['npm', 'test'] } }, 'PreToolUse');
  assert.strictEqual(n.hook_event_name, 'PreToolUse');
  assert.strictEqual(n.tool_input.command, 'npm test');
  assert.strictEqual(n.transcript_path, null);
  console.log('ok - Codex input: event from the command line, command as text');

  // Copilot: camelCase or snake_case input; the event name comes from the command line when the input has none.
  n = A.normalize('copilot', { sessionId: 'c1', cwd: 'C:/p', toolName: 'bash', toolArgs: '{"command":"npm run build"}' }, 'preToolUse');
  assert.deepStrictEqual([n.hook_event_name, n.session_id, n.tool_name, n.tool_input.command, n.transcript_path], ['PreToolUse', 'c1', 'Bash', 'npm run build', null]);
  n = A.normalize('copilot', { hook_event_name: 'sessionStart', session_id: 'c2', cwd: 'C:/p' }, '');
  assert.strictEqual(n.hook_event_name, 'SessionStart');
  assert.strictEqual(n.session_id, 'c2');
  n = A.normalize('copilot', { sessionId: 'c3', toolName: 'powershell', toolArgs: 'dir' }, 'postToolUse');
  assert.strictEqual(n.tool_name, 'PowerShell');
  assert.strictEqual(n.tool_input.command, 'dir');
  console.log('ok - Copilot input: camelCase and snake_case, event and tool names');

  // What is printed: Claude as before; Codex and Copilot only at session start, each in its own form.
  const ctx = 'Agent Dashboard is ON';
  assert.strictEqual(JSON.parse(A.output('claude', 'PreToolUse', ctx)).hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(A.output('codex', 'PreToolUse', ctx), '');
  assert.strictEqual(JSON.parse(A.output('codex', 'SessionStart', ctx)).hookSpecificOutput.additionalContext, ctx);
  assert.strictEqual(JSON.parse(A.output('copilot', 'SessionStart', ctx)).additionalContext, ctx);
  assert.strictEqual(A.output('copilot', 'SessionStart', ''), '');
  assert.strictEqual(A.output('copilot', 'UserPromptSubmit', ctx), '');
  console.log('ok - output: Claude as before; Codex and Copilot only at session start');

  // The instructions: Claude names its TODO tools; the others keep the TODO list with dash.js and no Claude-only commands.
  const gClaude = A.guideText(SCRIPTS, 'claude');
  const gCodex = A.guideText(SCRIPTS, 'codex');
  assert.ok(gClaude.includes('TodoWrite/TaskCreate'));
  assert.ok(!gCodex.includes('TodoWrite'), 'Codex instructions name no Claude tool');
  assert.ok(gCodex.includes('dash.js') && gCodex.includes('todo set'));
  assert.ok(!gCodex.includes("usage (Claude's"), 'no Claude-only commands');
  console.log('ok - instructions per agent');

  // Setup files: valid JSON, one command per event, with the agent and the event in the command.
  const codexCfg = JSON.parse(JSON.stringify(A.hookConfig('codex', SCRIPTS)));
  assert.ok(codexCfg.hooks.SessionStart[0].hooks[0].command.endsWith('--agent codex --event SessionStart'));
  assert.strictEqual(codexCfg.hooks.SessionEnd[0].hooks[0].timeout, 3);
  const copCfg = JSON.parse(JSON.stringify(A.hookConfig('copilot', SCRIPTS)));
  assert.strictEqual(copCfg.version, 1);
  assert.ok(copCfg.hooks.sessionStart[0].bash.endsWith('--agent copilot --event sessionStart'));
  assert.ok(copCfg.hooks.sessionEnd[0].powershell.includes('hook.js'));
  assert.ok(A.setupText('codex', SCRIPTS).includes('"hooks"'));
  assert.ok(A.setupText('copilot', SCRIPTS).includes('.github/hooks/agent-dashboard.json'));
  console.log('ok - setup files for Codex and Copilot');

  // hook.js run end to end. (The Claude session start is not run here: it may start the plugin update check.)
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project);
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: project, AGENT_DASH_HOME: tmp, USERPROFILE: tmp, HOME: tmp });
  const run = (args, input) => spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 30000 });

  let r = run(['--agent', 'copilot', '--event', 'sessionStart'], { sessionId: 'cp-1', cwd: project, timestamp: 1 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).additionalContext.includes('Agent Dashboard is ON'));
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput, undefined, 'Copilot gets its own form');

  r = run(['--agent', 'codex', '--event', 'SessionStart'], { session_id: 'cx-1', cwd: project, hook_event_name: 'SessionStart', source: 'startup' });
  assert.strictEqual(r.status, 0, r.stderr);
  const cxOut = JSON.parse(r.stdout).hookSpecificOutput;
  assert.strictEqual(cxOut.hookEventName, 'SessionStart');
  assert.ok(cxOut.additionalContext.includes('Agent Dashboard is ON') && !cxOut.additionalContext.includes('TodoWrite'));

  r = run(['--agent', 'copilot', '--event', 'preToolUse'], { sessionId: 'cp-1', cwd: project, toolName: 'bash', toolArgs: '{"command":"npm test"}' });
  assert.strictEqual(r.stdout, '', 'nothing printed for a tool call');

  r = run(['--agent', 'codex', '--event', 'UserPromptSubmit'], { session_id: 'cx-1', cwd: project, prompt: 'Fix the login bug' });
  assert.strictEqual(r.stdout, '');
  let st = S.load(project);
  assert.ok(st.sessions['cp-1'] && st.sessions['cx-1'], 'both sessions are on the dashboard');
  assert.strictEqual(st.sessions['cx-1'].title, 'Fix the login bug');
  console.log('ok - hook.js: Copilot and Codex session start, tool calls and prompts');

  r = run(['--agent', 'codex', '--event', 'SessionEnd'], { session_id: 'cx-1', cwd: project });
  r = run(['--agent', 'copilot', '--event', 'sessionEnd'], { sessionId: 'cp-1', cwd: project });
  st = S.load(project);
  assert.ok(!st.sessions['cx-1'] && !st.sessions['cp-1'], 'a session end removes the session');
  console.log('ok - session end removes the session');

  console.log('all agents tests passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
