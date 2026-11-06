// Tests for the screenshots Claude reads (hook.js captureShot) and their settings switch.
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

try {
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const env = Object.assign({}, process.env, { AGENT_DASH_ROOT: project, AGENT_DASH_HOME: home, USERPROFILE: home, HOME: home });
  const run = (input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 30000 });
  const readOf = (file) => ({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: project, tool_name: 'Read', tool_input: { file_path: file } });
  const png = path.join(project, 'shot.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const txt = path.join(project, 'notes.txt');
  fs.writeFileSync(txt, 'hello');

  // Off by default: nothing is copied and no list is kept.
  let r = run(readOf(png));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(S.load(project).shots, []);
  assert.ok(!fs.existsSync(path.join(project, '.agent-dashboard', 'shots')), 'no copies while the switch is off');
  assert.strictEqual(Settings.read().showScreenshots, false);
  console.log('ok - screenshots: off by default, nothing copied');

  // On: a picture Claude reads is copied into the project's shots folder and listed in state.json.
  Settings.update({ showScreenshots: true });
  r = run(readOf(png));
  assert.strictEqual(r.status, 0, r.stderr);
  let st = S.load(project);
  assert.strictEqual(st.shots.length, 1);
  assert.strictEqual(st.shots[0].name, 'shot.png');
  assert.ok(fs.existsSync(path.join(project, '.agent-dashboard', st.shots[0].file)), 'the copy exists');
  assert.ok(fs.existsSync(path.join(project, '.agent-dashboard', '.gitignore')), 'the folder keeps itself out of git');
  console.log('ok - screenshots: a PNG Claude reads is copied and listed');

  // Files that are not pictures are ignored.
  run(readOf(txt));
  assert.strictEqual(S.load(project).shots.length, 1);
  console.log('ok - screenshots: text files are ignored');

  // Only the last few pictures are kept, and the older copies are removed.
  for (let i = 0; i < 8; i++) run(readOf(png));
  st = S.load(project);
  assert.strictEqual(st.shots.length, 6);
  const copies = fs.readdirSync(path.join(project, '.agent-dashboard', 'shots'));
  assert.strictEqual(copies.length, 6, 'old copies are deleted');
  console.log('ok - screenshots: only the last 6 are kept');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('all screenshots tests passed');
