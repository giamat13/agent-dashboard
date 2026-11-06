'use strict';
// Other coding agents on the same dashboard: OpenAI Codex, GitHub Copilot and Google Antigravity send their hook events to hook.js as
// "--agent <name> --event <Event>". This module turns each agent's input into the shape hook.js reads, decides what
// the agent may be sent back, and writes the setup text (dash.js agent-setup). Claude Code is the default and is unchanged.
const path = require('path');

const AGENTS = ['claude', 'codex', 'copilot', 'antigravity'];
// The events an agent takes extra context from. Its other output formats are not used, so nothing else is printed for it.
const CONTEXT_EVENTS = { claude: null, codex: ['SessionStart'], copilot: ['SessionStart'], antigravity: ['SessionStart'] };
// The events each agent is set up for (Copilot names them in camelCase).
const SETUP_EVENTS = {
  codex: ['SessionStart', 'UserPromptSubmit', 'SessionEnd'],
  copilot: ['sessionStart', 'userPromptSubmitted', 'sessionEnd'],
  antigravity: ['SessionStart', 'PreInvocation', 'PostToolUse'],
};
const COPILOT_EVENTS = {
  sessionStart: 'SessionStart', sessionEnd: 'SessionEnd', userPromptSubmitted: 'UserPromptSubmit', preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse', agentStop: 'Stop', subagentStop: 'SubagentStop', errorOccurred: 'ErrorOccurred',
};

// "--agent codex --event SessionStart" from the command line. Anything unknown means Claude Code.
function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const value = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : ''; };
  const agent = value('--agent').toLowerCase();
  return { agent: AGENTS.includes(agent) ? agent : 'claude', event: value('--event') };
}

// The input of one hook call, in the shape hook.js reads: hook_event_name, session_id, cwd, tool_name, tool_input, prompt.
function normalize(agent, inp, event) {
  const o = inp && typeof inp === 'object' ? inp : {};
  if (agent === 'claude') return o;
  const out = Object.assign({}, o);
  out.transcript_path = null;   // the other agents keep their own session files; hook.js reads only Claude's transcript
  if (agent === 'codex') {
    if (!out.hook_event_name && event) out.hook_event_name = event;
    const ti = out.tool_input;
    if (ti && Array.isArray(ti.command)) out.tool_input = Object.assign({}, ti, { command: ti.command.join(' ') });
    return out;
  }
  if (agent === 'antigravity') {
    // camelCase input: the session is conversationId, the folder is the first workspace path, and run_command is a shell call.
    // PreInvocation counts as a new prompt only at the first model call of a turn (invocationNum 0); the others only keep the session alive.
    const tc = o.toolCall && typeof o.toolCall === 'object' ? o.toolCall : {};
    out.hook_event_name = event === 'PreInvocation' && o.invocationNum === 0 ? 'UserPromptSubmit' : event;
    out.session_id = String(o.conversationId || '');
    out.cwd = Array.isArray(o.workspacePaths) && o.workspacePaths.length ? String(o.workspacePaths[0]) : '';
    if (typeof o.lastUserInput === 'string') out.prompt = o.lastUserInput;
    const tool = String(tc.name || '');
    out.tool_name = tool === 'run_command' ? 'Bash' : tool;
    const args = tc.args && typeof tc.args === 'object' ? tc.args : {};
    out.tool_input = tool === 'run_command' ? Object.assign({}, args, { command: String(args.CommandLine || '') }) : args;
    return out;
  }
  // copilot: camelCase or snake_case fields. The event name comes from the hook command when the input has none.
  const name = o.hook_event_name || o.hookEventName || event || '';
  out.hook_event_name = COPILOT_EVENTS[name] || name;
  out.session_id = o.session_id || o.sessionId || '';
  const tool = o.tool_name || o.toolName || '';
  out.tool_name = /^bash$/i.test(tool) ? 'Bash' : /^powershell$/i.test(tool) ? 'PowerShell' : tool;
  let ti = o.tool_input || o.toolArgs || {};
  if (typeof ti === 'string') { try { ti = JSON.parse(ti); } catch { ti = { command: ti }; } }
  out.tool_input = ti && typeof ti === 'object' ? ti : {};
  if (typeof o.prompt !== 'string' && typeof o.initialPrompt === 'string') out.prompt = o.initialPrompt;
  return out;
}

// What hook.js prints for an event: the text added to the agent's context, in that agent's JSON form. '' prints nothing.
function output(agent, event, text) {
  const none = agent === 'antigravity' ? '{}' : '';   // Antigravity reads a JSON answer from every hook
  if (!text) return none;
  const allowed = CONTEXT_EVENTS[agent];
  if (allowed && !allowed.includes(event)) return none;
  if (agent === 'copilot') return JSON.stringify({ additionalContext: text });
  if (agent === 'antigravity') return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

// The instructions every agent gets at the start of a session. Claude also has TodoWrite; the others keep the list with dash.js.
function guideText(scriptsDir, agent) {
  const DASH = path.join(scriptsDir, 'dash.js').replace(/\\/g, '/');
  const WRAP = path.join(scriptsDir, 'wrap.js').replace(/\\/g, '/');
  const claude = agent === 'claude';
  const todoLine = claude
    ? 'TODOs sync automatically from TodoWrite. If you have NO TodoWrite/TaskCreate tool in this session, you MUST still keep the user\'s TODO list yourself, for any task with 2+ steps:'
    : 'Keep the user\'s TODO list yourself, for any task with 2+ steps:';
  const usageCmd = claude ? `, node "${DASH}" usage (Claude's 5-hour and weekly limits)` : '';
  return `Agent Dashboard is ON: the user watches a live progress dashboard inside VS Code (TODOs, context, long-running scripts).
FULLY AUTONOMOUS: never wait to be told. Update it continuously, add an estimate to a TODO item only if it helps ("item ~5m", optional), and split every step into small sub-steps YOURSELF, each with its own estimate (--subs "a~2m|b~90s"), then sub start/done as you go. If one build, test or script runs several checks (for example several test files), each check is its own sub-step: list them all in --subs (or as @@sub lines) and mark each sub done as it passes. KEEP THE DASHBOARD LIVE ALL THE TIME: mark TODO items done/doing at every step change, update now/eta at every output check, and never go more than 5 tool calls without a dashboard update (TODO, now or eta).
PREFERRED for real scripts: wrap the command so the dashboard is live and automatic (heartbeat, last output line, auto % and ETA from the output, exit code):
  node "${WRAP}" --title "<title>" --plain "<plain sentence>" --steps "step1::plain|step2::plain" -- <the real command>
(run that wrapper command itself in the background). The script may also print lines "@@step 2", "@@sub done", "@@now <text>", "@@eta 5m", "@@job start|done|fail <name>" to drive the dashboard. Stages are always dynamic: name them yourself per project (--steps, or @@step <new name> adds one on the fly). Parallel things: node "${DASH}" job start <name> --eta 3m (ALWAYS give --eta, otherwise the card shows no time left) | job done|fail <name>. Live line: node "${DASH}" log "<text>". User goal (/goal) is shown automatically; set manually with node "${DASH}" goal "<text>".
Otherwise (manual reporting) for EVERY build, test, install, migration, packaging step or script (do not judge whether it is short or long; only bare ls/pwd/echo/cat/git status|log|diff and file reads are exempt) report progress with:
  node "${DASH}" run start "<title>" --plain "<one plain sentence a non-technical person understands>" --steps "step1::plain explanation|step2::plain explanation" --eta 20m
  node "${DASH}" step start <n|name> --plain "<what is happening, simple words>" --eta 4m --subs "sub1~2m|sub2~90s|sub3~30s"   # every sub-step gets its own estimate after ~
  node "${DASH}" sub done [n|all]      # finish a sub-step
  node "${DASH}" now "<what is happening right now, simple words, with counts like '33 of 36 done' or '45%': the progress bar follows them>"
  node "${DASH}" eta 6m                # ESTIMATE FROM NOW for the current step. Update it EVERY time you check on the script.
  node "${DASH}" eta 6m --total        # TOTAL TIME LEFT for the WHOLE run, from now. Keep it true: give it at run start (run start --eta), and update it whenever the plan changes (a step starts or ends, an estimate changes, steps or sub-steps are added or dropped). If the dashboard or dash.js says it is out of date, fix it at once. If you forget, the dashboard works it out from the steps and says so, but you must still update it.
  node "${DASH}" step done | step fail "<reason>" ; node "${DASH}" run done|fail --summary "<result in plain words>"
Other commands: node "${DASH}" ci-eta "<workflow name>" 6m (the expected time of a GitHub Actions workflow; "ci-eta clear <name>" removes it)${usageCmd}.
Run the long command in the background, then check its output every 1-2 minutes and update the dashboard (step/sub/now/eta) each time.
Write all dashboard texts in English, in simple words, no jargon (the user may not be technical). ${todoLine} at the start run node "${DASH}" todo set "[~] current item|next item|another item" ; as you progress run node "${DASH}" todo done <n> / todo doing <n> / todo add "new item" (items marked [x]=done, [~]=in progress). Run these in the background like any command.`;
}

// The hook registrations for an agent, as the config file it reads. scriptsDir: the folder that holds hook.js.
function hookConfig(agent, scriptsDir) {
  const hook = path.join(scriptsDir, 'hook.js').replace(/\\/g, '/');
  const cmd = (ev) => `node "${hook}" --agent ${agent} --event ${ev}`;
  if (agent === 'antigravity') {
    // Antigravity's hooks.json: one named block, each event a list of handlers (with an optional matcher).
    const one = (ev, timeout, matcher) => {
      const item = { hooks: [{ type: 'command', command: cmd(ev), timeout }] };
      if (matcher) item.matcher = matcher;
      return [item];
    };
    return { 'agent-dashboard': { SessionStart: one('SessionStart', 10), PreInvocation: one('PreInvocation', 10), PostToolUse: one('PostToolUse', 10, '*') } };
  }
  if (agent === 'codex') {
    const one = (ev, timeout) => [{ hooks: [{ type: 'command', command: cmd(ev), timeout }] }];
    return { hooks: { SessionStart: one('SessionStart', 10), UserPromptSubmit: one('UserPromptSubmit', 10), SessionEnd: one('SessionEnd', 3) } };
  }
  if (agent === 'copilot') {
    const hooks = {};
    for (const ev of SETUP_EVENTS.copilot) hooks[ev] = [{ type: 'command', bash: cmd(ev), powershell: cmd(ev), timeoutSec: 10 }];
    return { version: 1, hooks };
  }
  throw new Error('no setup for agent: ' + agent);
}

// The text for dash.js agent-setup: what to save where. Nothing is written by the dashboard.
function setupText(agent, scriptsDir) {
  const json = JSON.stringify(hookConfig(agent, scriptsDir), null, 2);
  const guide = guideText(scriptsDir, agent);
  if (agent === 'antigravity') {
    return [
      '1) Merge the "agent-dashboard" block below into ~/.gemini/config/hooks.json (keep your own hooks). That file is shared by the Antigravity app, CLI and IDE.',
      '2) Restart Antigravity. Check the hooks in the agent panel: the ... menu > Customizations > Hooks.',
      '3) Nothing else to add: the hook sends the dashboard instructions at the start of each conversation.',
      '', json,
    ].join('\n');
  }
  if (agent === 'codex') {
    return [
      '1) Merge the "hooks" below into ~/.codex/hooks.json (keep your own hooks).',
      '2) Start Codex and run /hooks to review and trust them. Codex does not run new hooks before that.',
      '3) Put the instructions below in ~/.codex/AGENTS.md, or in AGENTS.md of a project.',
      '', json, '', '--- instructions ---', '## Agent Dashboard', '', guide,
    ].join('\n');
  }
  return [
    '1) Save the JSON below as .github/hooks/agent-dashboard.json in the repository.',
    '2) Put the instructions below in .github/copilot-instructions.md of the repository.',
    '   Copilot CLI and the cloud agent run these hooks. Check that your editor runs them too.',
    '', json, '', '--- instructions ---', '## Agent Dashboard', '', guide,
  ].join('\n');
}

module.exports = { AGENTS, CONTEXT_EVENTS, SETUP_EVENTS, COPILOT_EVENTS, parseArgs, normalize, output, guideText, hookConfig, setupText };
