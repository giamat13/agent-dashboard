// Tests for the GitHub Actions card's data (vscode-extension/lib/gh.js). Run: node tests/gh.test.js
'use strict';
const assert = require('assert');
const GH = require('../vscode-extension/lib/gh');

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ago = (sec) => new Date(NOW - sec * 1000).toISOString();

// A run as `gh run list --json` gives it.
function run(o) {
  return Object.assign({
    databaseId: 1, displayTitle: 'Change', workflowName: 'CI', name: 'CI', status: 'completed', conclusion: 'success',
    createdAt: ago(900), startedAt: ago(900), updatedAt: ago(800), headBranch: 'main', event: 'push', url: 'https://example.test/run',
  }, o);
}
// A finished run that took `durSec` seconds, ended `endedAgo` seconds ago.
const done = (id, workflow, durSec, endedAgo, conclusion) => run({
  databaseId: id, workflowName: workflow, name: workflow, status: 'completed', conclusion: conclusion || 'success',
  startedAt: ago(endedAgo + durSec), updatedAt: ago(endedAgo), createdAt: ago(endedAgo + durSec),
});

// repoFromRemote
assert.strictEqual(GH.repoFromRemote('https://github.com/GIAMAT13/agent-dashboard.git'), 'GIAMAT13/agent-dashboard');
assert.strictEqual(GH.repoFromRemote('git@github.com:giamat13/agent-dashboard.git\n'), 'giamat13/agent-dashboard');
assert.strictEqual(GH.repoFromRemote('https://github.com/owner/repo/'), 'owner/repo');
assert.strictEqual(GH.repoFromRemote('https://gitlab.com/a/b.git'), null);
assert.strictEqual(GH.repoFromRemote(''), null);
console.log('ok - the repository name is read from the remote address');

// median
assert.strictEqual(GH.median([]), null);
assert.strictEqual(GH.median([5]), 5);
assert.strictEqual(GH.median([1, 2, 3, 4]), 2.5);
assert.strictEqual(GH.median([NaN, -1, 10]), 10);
console.log('ok - the median ignores values that are not usable');

// Pages deploys are recognised by their workflow name.
assert.strictEqual(GH.isPages({ workflowName: 'pages-build-deployment', name: 'pages build and deployment' }), true);
assert.strictEqual(GH.isPages({ workflowName: 'Deploy to GitHub Pages', name: 'x' }), true);
assert.strictEqual(GH.isPages({ workflowName: 'CI', name: 'CI' }), false);
assert.strictEqual(GH.isPages({ workflowName: 'Build pages site', name: 'Build pages site' }), false);
console.log('ok - GitHub Pages deploys are recognised');

// Command errors become short reasons.
const err = (code, stderr) => Object.assign(new Error(stderr || 'failed'), { code, stderr });
assert.strictEqual(GH.reasonOf(err('ENOENT')), 'gh-missing');
assert.strictEqual(GH.reasonOf(err(1, 'To get started with GitHub CLI, please run:  gh auth login')), 'not-logged-in');
assert.strictEqual(GH.reasonOf(err(2, "error: No such remote 'origin'")), 'no-remote');
assert.strictEqual(GH.reasonOf(err(128, 'fatal: not a git repository (or any of the parent directories)')), 'no-remote');
assert.strictEqual(GH.reasonOf(err(1, 'error connecting to api.github.com')), 'offline');
assert.strictEqual(GH.reasonOf(err(1, 'something else went wrong')), 'failed');
console.log('ok - command errors are sorted into short reasons');

// fetchRuns with a fake command runner: no real git or gh is called.
(async () => {
  const calls = [];
  const okRun = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'git') return 'https://github.com/GIAMAT13/agent-dashboard.git\n';
    return JSON.stringify([run({ databaseId: 9 })]);
  };
  const ok = await GH.fetchRuns('C:/work/project', { run: okRun });
  assert.strictEqual(ok.repo, 'GIAMAT13/agent-dashboard');
  assert.strictEqual(ok.runs.length, 1);
  assert.ok(calls.some(([c, a]) => c === 'gh' && a.includes('--repo') && a.includes('GIAMAT13/agent-dashboard') && a.includes('--json') && a.includes(GH.FIELDS)),
    'gh is asked for the runs of the repository, with the fields the card uses');
  console.log('ok - runs are read for the repository of the folder');

  // The repository can be given directly: git is not asked.
  const seen = [];
  const given = await GH.fetchRuns('C:/work/project', { repo: 'owner/repo', run: async (cmd) => { seen.push(cmd); return '[]'; } });
  assert.deepStrictEqual(given, { repo: 'owner/repo', runs: [] });
  assert.deepStrictEqual(seen, ['gh']);
  console.log('ok - a given repository skips the git lookup');

  assert.deepStrictEqual(await GH.fetchRuns('C:/work/project', { run: async () => { throw err(128, 'fatal: not a git repository'); } }), { error: 'no-remote' });
  assert.deepStrictEqual(await GH.fetchRuns('C:/work/project', {
    run: async (cmd) => { if (cmd === 'git') return 'git@github.com:GIAMAT13/agent-dashboard.git'; throw err('ENOENT'); },
  }), { repo: 'GIAMAT13/agent-dashboard', error: 'gh-missing' });
  assert.deepStrictEqual(await GH.fetchRuns('C:/work/project', {
    run: async (cmd) => { if (cmd === 'git') return 'https://github.com/a/b.git'; throw err(4, 'To get started with GitHub CLI, please run:  gh auth login'); },
  }), { repo: 'a/b', error: 'not-logged-in' });
  assert.deepStrictEqual(await GH.fetchRuns('C:/work/project', {
    run: async (cmd) => (cmd === 'git' ? 'https://github.com/a/b.git' : 'not json'),
  }), { repo: 'a/b', error: 'failed' });
  console.log('ok - missing remote, missing gh, not logged in and bad output each give a short reason');

  // summarize: what is running (with its estimate), the recent finished runs, and the Pages deploy on its own.
  const history = [
    done(11, 'CI', 100, 1000), done(12, 'CI', 120, 2000), done(13, 'CI', 140, 3000),
    done(14, 'CI', 90, 4000, 'failure'),
    done(15, 'pages-build-deployment', 30, 500),
  ];
  const runs = [
    run({ databaseId: 1, displayTitle: 'Fix login', status: 'in_progress', conclusion: '', startedAt: ago(120), updatedAt: ago(120) }),
    run({ databaseId: 2, displayTitle: 'Release', workflowName: 'Release', name: 'Release', status: 'queued', conclusion: '', startedAt: ago(5), updatedAt: ago(5) }),
    run({ databaseId: 3, displayTitle: 'Pages deploy', workflowName: 'pages-build-deployment', name: 'pages build and deployment', status: 'in_progress', conclusion: '', startedAt: ago(20), updatedAt: ago(20) }),
    ...history,
  ];
  const s = GH.summarize(runs, { now: NOW, ciEta: {} });
  assert.deepStrictEqual(s.running.map((r) => r.title), ['Fix login', 'Release']);
  const ci = s.running[0];
  assert.strictEqual(ci.estimateSec, 120, 'the usual time is the median of the last successful runs');
  assert.strictEqual(ci.estimateFrom, 'history');
  assert.strictEqual(s.running[1].estimateSec, null, 'no history and no estimate: no estimate');
  assert.strictEqual(s.running[1].estimateFrom, 'none');
  assert.strictEqual(s.pages.status, 'in_progress', 'the Pages deploy is shown on its own');
  assert.ok(s.recent.every((r) => !/pages/i.test(r.workflow)), 'Pages runs are not in the recent list');
  assert.strictEqual(s.running[1].status, 'queued');
  assert.ok(s.recent.length <= 5);
  assert.strictEqual(s.recent[0].conclusion, 'success');
  console.log('ok - running runs get the usual time; Pages is kept apart');

  // Claude's estimate for a workflow wins over the usual time, whatever the case of the name.
  const claude = GH.summarize(runs, { now: NOW, ciEta: { ci: { sec: 600, at: NOW } } });
  assert.strictEqual(claude.running[0].estimateSec, 600);
  assert.strictEqual(claude.running[0].estimateFrom, 'claude');
  const release = GH.summarize(runs, { now: NOW, ciEta: { RELEASE: { sec: 300, at: NOW } } });
  assert.strictEqual(release.running[1].estimateSec, 300);
  assert.strictEqual(release.running[1].estimateFrom, 'claude');
  assert.strictEqual(release.running[0].estimateFrom, 'history', 'other workflows keep their usual time');
  console.log('ok - an estimate from Claude replaces the usual time for its workflow only');

  // Empty input gives an empty card.
  assert.deepStrictEqual(GH.summarize([], { now: NOW }).running, []);
  assert.strictEqual(GH.summarize([], { now: NOW }).pages, null);
  console.log('ok - no runs gives an empty card');

  console.log('all gh tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
