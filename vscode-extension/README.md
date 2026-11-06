# Agent Dashboard

A live dashboard for [Claude Code](https://claude.com/claude-code) inside VS Code. It shows, in plain language:

- **Long scripts and tests**: steps, sub-steps, a live progress ring, "what is happening now", and estimated time left (per step and in total). Warns when a script goes quiet or the connection is lost.
- **Claude's to-do list**: synced automatically.
- **Context**: how full Claude's memory is, measured against your auto-compact limit.

## How it works

This extension only displays data. The companion Claude Code plugin (`agent-dashboard`, in the `claude-plugin` folder of the repo) writes `.agent-dashboard/state.json` in your project: hooks sync the to-dos and context, and `wrap.js` runs a real script and reports its progress live.

## Usage

1. Install this extension and the Claude plugin.
2. Click the **Agents** item in the status bar, or run **Agent Dashboard: Open in large window**.
3. Ask Claude to run your tests. Long commands are wrapped automatically.

Commands: `Agent Dashboard: Open in large window`, `Agent Dashboard: Clear history`, `Agent Dashboard: Check for updates`.

Setting: `agentDashboard.staleMinutes` (default 3) — minutes of silence before a "possibly stuck" warning.

MIT © GIAMAT13

## New in 0.4.1

- **Codex and GitHub Copilot limits**: shown only for paid plans. A limit that exists only on the free plan is not shown, so a free plan shows no card. Codex: 5-hour and weekly limits from its local session files. Copilot: the premium-request allowance, read through the `gh` CLI.
- **Codex and Copilot progress**: run `dash.js agent-setup codex` or `dash.js agent-setup copilot` (in the plugin's `scripts` folder). It prints the hook settings and instructions to add. Nothing is written for you.

## New in 0.4.0

- **Updates**: the extension checks GitHub Releases about 20 seconds after it starts and then every hour, verifies the checksum and installs a newer version. Reload the window afterwards.
- **GitHub Actions card**: the latest runs of this repository, with the time left for a running workflow. Pages deployments are shown small. Needs the `gh` CLI, logged in.
- **Local API**: read-only, on 127.0.0.1 only. `dash.js status` shows its address.
- **Switches** in the settings card: usage estimate and recording, GitHub Actions, local API, and extension and plugin auto-update.

## New in 0.3.0

Works for any project: nothing is hard-coded, all stages come from Claude or your script.

- Four tiles: progress ring, total time left, "Now", and counts.
- Dynamic pipeline: stages from `--steps` or `@@step <name>` (added on the fly).
- Live activity log with a "stuck" warning.
- Tasks card (finished tasks collapse to one line).
- Parallel jobs: `@@job start|done|fail <name>` or `dash.js job ...`, with live pass/fail and output tail.
- Time estimates learned from previous runs.
- Failure details, freshness warnings, idle/done/failed states.
- `/goal` text is shown at the top (or `dash.js goal "text"`).
- `dash.js reset` archives the page to `.agent-dashboard/archive/` and starts clean.
