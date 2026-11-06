// Tests for the screenshots Claude reads (hook.js captureShot) and their settings switch.
// Each session keeps its own list: a picture read in one session never shows in another.
// Run: node tests/screenshots.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'claude-plugin', 'scripts');
const HOOK = path.join(SCRIPTS, 'hook.js');
const S = require(path.join(SCRIPTS, 'lib', 'state'));
const Settings = require(path.join(SCRIPTS, 'lib', 'settings'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-shots-'));
const project = path.join(tmp, 'project');
const home = path.join(tmp, 'home');
process.env.AGENT_DASH_HOME = home;   // the settings file lives here, for this process and the hook it starts

// The pictures one session keeps (the state file keeps them per session).
const shotsOf = (st, sid) => (((st.sessions || {})[sid]) || {}).shots || [];

try {
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: project, AGENT_DASH_HOME: home, USERPROFILE: home, HOME: home });
  const run = (input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 30000 });
  const readOf = (file, sid) => ({ hook_event_name: 'PostToolUse', session_id: sid || 's1', cwd: project, tool_name: 'Read', tool_input: { file_path: file } });
  const png = path.join(project, 'shot.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const txt = path.join(project, 'notes.txt');
  fs.writeFileSync(txt, 'hello');

  // Off by default: nothing is copied and no list is kept.
  let r = run(readOf(png));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(shotsOf(S.load(project), 's1'), []);
  assert.ok(!fs.existsSync(path.join(project, '.agent-dashboard', 'shots')), 'no copies while the switch is off');
  assert.strictEqual(Settings.read().showScreenshots, false);
  console.log('ok - screenshots: off by default, nothing copied');

  // On: a picture Claude reads is copied into the project's shots folder and listed for its session in state.json.
  Settings.update({ showScreenshots: true });
  r = run(readOf(png));
  assert.strictEqual(r.status, 0, r.stderr);
  let st = S.load(project);
  let list = shotsOf(st, 's1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'shot.png');
  assert.ok(fs.existsSync(path.join(project, '.agent-dashboard', list[0].file)), 'the copy exists');
  assert.ok(fs.existsSync(path.join(project, '.agent-dashboard', '.gitignore')), 'the folder keeps itself out of git');
  console.log('ok - screenshots: a PNG Claude reads is copied and listed for its session');

  // Files that are not pictures are ignored.
  run(readOf(txt));
  assert.strictEqual(shotsOf(S.load(project), 's1').length, 1);
  console.log('ok - screenshots: text files are ignored');

  // Another session reads a picture: it gets its own list, and session 1 does not show it.
  r = run(readOf(png, 's2'));
  assert.strictEqual(r.status, 0, r.stderr);
  st = S.load(project);
  assert.strictEqual(shotsOf(st, 's2').length, 1, 'session 2 lists its own picture');
  assert.strictEqual(shotsOf(st, 's1').length, 1, 'session 1 still lists only its own picture');
  assert.notStrictEqual(shotsOf(st, 's2')[0].file, shotsOf(st, 's1')[0].file, 'each picture has its own copy');
  console.log('ok - screenshots: each session keeps its own list');

  // Only the last few pictures of a session are kept, and the older copies are removed.
  for (let i = 0; i < 8; i++) run(readOf(png, 's1'));
  st = S.load(project);
  assert.strictEqual(shotsOf(st, 's1').length, 6);
  assert.strictEqual(shotsOf(st, 's2').length, 1, 'session 2 is not touched by session 1');
  const copies = fs.readdirSync(path.join(project, '.agent-dashboard', 'shots'));
  assert.strictEqual(copies.length, 7, 'old copies are deleted: 6 of session 1 and 1 of session 2');
  console.log('ok - screenshots: only the last 6 are kept per session');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('all screenshots tests passed');
