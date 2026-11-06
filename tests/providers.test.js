// Tests for the Codex and Copilot limits (vscode-extension/lib/providers.js). Only the paid-plan limits are read.
// Run: node tests/providers.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require('../vscode-extension/lib/providers');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dash-providers-'));

// A Codex session file: one event line per reading, as Codex writes them.
const win = (minutes, used, resets) => ({ used_percent: used, window_minutes: minutes, resets_at: resets });
const reading = (ts, rl) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });
const PAID = { limit_id: 'codex', primary: win(300, 40, 1795873786), secondary: win(10080, 12, 1796478586), plan_type: 'plus' };
const FREE = { limit_id: 'codex', primary: win(43200, 73, 1795873786), secondary: null, plan_type: 'free' };
const writeRollout = (sub, name, lines) => {
  const d = path.join(tmp, 'codex', sub);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), lines.join('\n') + '\n');
};

(async () => {
  try {
    const codexDir = path.join(tmp, 'codex');

    // The session folders are read newest first, archived sessions included.
    writeRollout(path.join('sessions', '2026', '11', '02'), 'rollout-2026-11-02T10-00-00-a.jsonl', [reading('2026-11-02T10:00:00Z', PAID)]);
    writeRollout(path.join('sessions', '2026', '11', '03'), 'rollout-2026-11-03T19-07-33-b.jsonl', [reading('2026-11-03T19:07:33Z', PAID)]);
    writeRollout('archived_sessions', 'rollout-2026-11-03T20-00-00-c.jsonl', ['{"type":"session_meta"}']);
    const files = P.rolloutFiles(codexDir).map((f) => path.basename(f));
    assert.deepStrictEqual(files, ['rollout-2026-11-03T20-00-00-c.jsonl', 'rollout-2026-11-03T19-07-33-b.jsonl', 'rollout-2026-11-02T10-00-00-a.jsonl']);
    console.log('ok - session files are found newest first, archived ones too');

    // A paid plan: the five-hour and weekly windows, with the percent used and the reset time.
    let u = P.codexUsage({ dir: codexDir });
    assert.strictEqual(u.fiveHour.pct, 40);
    assert.strictEqual(u.fiveHour.resetsAt, 1795873786 * 1000);
    assert.strictEqual(u.weekly.pct, 12);
    assert.strictEqual(u.weekly.resetsAt, 1796478586 * 1000);
    console.log('ok - paid windows: 5-hour and weekly');

    // The newest reading decides: a free-plan reading (monthly window only) hides the older paid numbers.
    writeRollout(path.join('sessions', '2026', '11', '04'), 'rollout-2026-11-04T08-00-00-d.jsonl', [reading('2026-11-04T08:00:00Z', FREE)]);
    u = P.codexUsage({ dir: codexDir });
    assert.strictEqual(u.plan, 'free');
    assert.strictEqual(u.fiveHour, null);
    assert.strictEqual(u.weekly, null, 'the monthly window is not shown');
    console.log('ok - a free plan (monthly window only) shows no limit');

    // A newer file with no reading yet: the newest reading in an older file is used.
    writeRollout(path.join('sessions', '2026', '11', '05'), 'rollout-2026-11-05T08-00-00-e.jsonl', ['{"type":"session_meta"}', reading('2026-11-05T08:00:01Z', null)]);
    u = P.codexUsage({ dir: codexDir });
    assert.strictEqual(u.plan, 'free', 'a null reading is skipped, the free reading from 11-04 is still the newest');
    console.log('ok - a null reading is skipped');

    // Nothing at all: no data, so nothing is shown.
    assert.strictEqual(P.codexUsage({ dir: path.join(tmp, 'nothing-here') }), null);
    console.log('ok - no Codex sessions gives no data');

    // Window pick: the order of primary and secondary does not matter.
    const swapped = P.pickCodex({ primary: win(10080, 5, null), secondary: win(300, 9, 1000), plan_type: 'pro' });
    assert.strictEqual(swapped.fiveHour.pct, 9);
    assert.strictEqual(swapped.fiveHour.resetsAt, 1000000);
    assert.strictEqual(swapped.weekly.pct, 5);
    assert.strictEqual(swapped.weekly.resetsAt, null);
    console.log('ok - the windows are matched by length, not by slot');

    // Copilot: the premium allowance only. Free (no allowance) shows nothing; chat and completions are never shown.
    const free = { copilot_plan: 'individual', quota_reset_date: '2026-12-01', quota_snapshots: {
      chat: { entitlement: 200, percent_remaining: 100, remaining: 200, unlimited: false },
      completions: { entitlement: 2000, percent_remaining: 99.8, remaining: 1997, unlimited: false },
      premium_interactions: { entitlement: 0, percent_remaining: 0, remaining: 0, unlimited: false } } };
    assert.strictEqual(P.pickCopilot(free), null);
    const pro = { copilot_plan: 'individual', quota_reset_date: '2026-12-01', quota_snapshots: {
      chat: { entitlement: 200, percent_remaining: 100, remaining: 200, unlimited: true },
      premium_interactions: { entitlement: 300, percent_remaining: 80, remaining: 240, unlimited: false } } };
    const cp = P.pickCopilot(pro);
    assert.strictEqual(cp.pct, 20);
    assert.strictEqual(cp.resetsAt, Date.parse('2026-12-01T00:00:00Z'));
    assert.strictEqual(P.pickCopilot({ quota_snapshots: { premium_interactions: { entitlement: 300, percent_remaining: 75 } } }).pct, 25);
    assert.strictEqual(P.pickCopilot({ quota_snapshots: { premium_interactions: { entitlement: 10, remaining: 0, unlimited: true } } }), null, 'unlimited: nothing to show');
    console.log('ok - Copilot: only the premium allowance, and only when the plan has one');

    // Copilot reading through the GitHub CLI (a fake here).
    const asked = [];
    const okRun = (args) => { asked.push(args.join(' ')); return Promise.resolve(JSON.stringify(pro)); };
    let c = await P.copilotUsage({ run: okRun });
    assert.deepStrictEqual(asked, ['api copilot_internal/user']);
    assert.strictEqual(c.plan, 'individual');
    assert.strictEqual(c.premium.pct, 20);
    assert.strictEqual((await P.copilotUsage({ run: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' })) })).error, 'no-gh');
    assert.strictEqual((await P.copilotUsage({ run: () => Promise.reject(new Error('exit 1')) })).error, 'gh-failed');
    assert.strictEqual((await P.copilotUsage({ run: () => Promise.resolve('not json') })).error, 'bad-response');
    console.log('ok - Copilot reading: the CLI call, and its errors');

    // Both agents together. Copilot is asked again only after five minutes.
    let calls = 0;
    const countRun = () => { calls++; return Promise.resolve(JSON.stringify(pro)); };
    const now = Date.parse('2026-11-06T12:00:00Z');
    let all = await P.readAll({ dir: codexDir, now, run: countRun });
    assert.strictEqual(all.at, now);
    assert.strictEqual(all.codex.plan, 'free', 'Codex is read with the same newest-reading rule');
    assert.strictEqual(calls, 1);
    all = await P.readAll({ dir: codexDir, now: now + 60 * 1000, previous: all, run: countRun });
    assert.strictEqual(calls, 1, 'a minute later: the Copilot reading is kept');
    assert.strictEqual(all.copilot.premium.pct, 20);
    await P.readAll({ dir: codexDir, now: now + 6 * 60 * 1000, previous: all, run: countRun });
    assert.strictEqual(calls, 2, 'after five minutes: asked again');
    console.log('ok - readAll: Codex every time, Copilot every five minutes');

    console.log('all providers tests passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
