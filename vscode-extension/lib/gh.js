'use strict';
// GitHub Actions runs for the dashboard's card. Reads them with the GitHub CLI (gh), with the account the user is logged in with.
// Estimates for running runs: a time Claude set with `dash.js ci-eta "<workflow>" <time>` wins; otherwise the median of the
// last successful runs of the same workflow. The GitHub Pages deploy is not in the list: it is shown on its own, in small text.
const { execFile } = require('child_process');

const RUNNING = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
const FIELDS = 'databaseId,displayTitle,workflowName,name,status,conclusion,createdAt,startedAt,updatedAt,headBranch,event,url';

// GitHub Pages deploys: the built-in "pages-build-deployment" workflow, or a workflow named after GitHub Pages.
const PAGES_RE = /pages-build-deployment|pages build and deployment|github pages/i;
const isPages = (r) => PAGES_RE.test(String((r && r.workflowName) || '') + ' ' + String((r && r.name) || ''));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function median(list) {
  const a = list.filter((x) => typeof x === 'number' && isFinite(x) && x >= 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// "https://github.com/owner/repo.git" or "git@github.com:owner/repo" -> "owner/repo". Anything else -> null.
function repoFromRemote(url) {
  const m = String(url || '').trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? m[1] + '/' + m[2] : null;
}

// The short reason the card shows, from the error of a command.
function reasonOf(err) {
  if (err && err.code === 'ENOENT') return 'gh-missing';
  const text = String((err && (err.stderr || err.message)) || err || '');
  if (/gh auth login|not logged|auth login|HTTP 401|authentication required/i.test(text)) return 'not-logged-in';
  if (/error connecting to api\.github\.com|check your internet|no such host|dial tcp|could not resolve host|i\/o timeout/i.test(text)) return 'offline';
  if (/no such remote|not a git repository|no git remotes|none of the git remotes/i.test(text)) return 'no-remote';
  return 'failed';
}

// Runs a command and resolves to its output. Tests pass their own `run`.
function defaultRun(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); return reject(err); }
      resolve(String(stdout || ''));
    });
  });
}

// The runs of the GitHub repository of this folder (newest first). Resolves to { repo, runs } or { repo, error }.
async function fetchRuns(cwd, opts) {
  const o = opts || {};
  const run = o.run || defaultRun;
  let repo = o.repo || null;
  if (!repo) {
    try { repo = repoFromRemote(await run('git', ['-C', cwd, 'remote', 'get-url', 'origin'], cwd)); } catch (e) { return { error: reasonOf(e) }; }
    if (!repo) return { error: 'no-remote' };
  }
  try {
    const out = await run('gh', ['run', 'list', '--repo', repo, '--limit', String(o.limit || 20), '--json', FIELDS], cwd);
    const runs = JSON.parse(out || '[]');
    return { repo, runs: Array.isArray(runs) ? runs : [] };
  } catch (e) {
    return { repo, error: reasonOf(e) };
  }
}

// The card's data from the runs. ciEta: { "<workflow>": { sec, at } } from the dashboard state.
function summarize(runs, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const ciEta = o.ciEta || {};
  const list = Array.isArray(runs) ? runs : [];
  const normal = list.filter((r) => !isPages(r));
  const pages = list.filter(isPages);
  const done = (r) => r.status === 'completed';
  const started = (r) => r.startedAt || r.createdAt || null;
  const secs = (r) => (Date.parse(r.updatedAt) - Date.parse(started(r))) / 1000;

  function estimateFor(workflow) {
    const key = Object.keys(ciEta).find((k) => same(k, workflow));
    const c = key ? ciEta[key] : null;
    if (c && typeof c.sec === 'number' && c.sec > 0) return { sec: c.sec, from: 'claude' };
    const h = median(normal.filter((r) => done(r) && r.conclusion === 'success' && same(r.workflowName, workflow)).slice(0, 5).map(secs));
    return h === null ? { sec: null, from: 'none' } : { sec: Math.round(h), from: 'history' };
  }

  const running = normal.filter((r) => RUNNING.includes(r.status)).map((r) => {
    const e = estimateFor(r.workflowName);
    return {
      title: r.displayTitle || r.name || '', workflow: r.workflowName || '', branch: r.headBranch || '', event: r.event || '', status: r.status || '',
      startedAt: started(r), estimateSec: e.sec, estimateFrom: e.from, url: r.url || '',
    };
  });
  const recent = normal.filter(done).slice(0, 5).map((r) => ({
    title: r.displayTitle || r.name || '', workflow: r.workflowName || '', branch: r.headBranch || '',
    conclusion: r.conclusion || '', endedAt: r.updatedAt || null, durationSec: Math.round(secs(r)) || 0, url: r.url || '',
  }));
  const p = pages.find((r) => !done(r)) || pages[0] || null;   // a deploy that is going on first, else the newest
  const pagesOut = p ? { status: p.status, conclusion: p.conclusion || '', at: p.updatedAt || null, url: p.url || '' } : null;
  return { running, recent, pages: pagesOut, at: now };
}

module.exports = { RUNNING, FIELDS, isPages, median, repoFromRemote, reasonOf, fetchRuns, summarize };
