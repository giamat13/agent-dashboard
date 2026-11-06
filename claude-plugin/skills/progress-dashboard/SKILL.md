---
name: progress-dashboard
description: Full reference for the Agent Dashboard commands (runs, steps, sub-steps, jobs, ETA, usage log). Load only when the user asks about the dashboard or turned on the detailedUpdates setting; the short session-start instructions cover normal work.
---

# Progress Dashboard

The user watches a dashboard in VS Code. It must cost as little Claude usage as possible.
`DASH` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/dash.js"`, `WRAP` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/wrap.js"` (the exact paths are in the session-start text).

## The rule that saves usage

Every tool call re-reads the whole chat. So **never make a tool call only to update the dashboard**. Put dashboard commands in front of a command you run anyway: `DASH todo done 2 && npm test`.

## Normal work (default)

- 2+ step task: TODO list with `TodoWrite`/`TaskCreate` (synced by the hooks). Without them: `DASH todo set "[~] a|b|c"`; `DASH todo done <n>` also starts the next item.
- Builds, tests, installs: `WRAP --title "<short title>" -- <command>`, in the background. Progress, time and the result are automatic. A script can print `@@step <name>`, `@@now <text>`, `@@eta 5m` to steer it.
- The live line comes from the `description` of each Bash/PowerShell call. Nothing to do.
- Planned usage (setting `claudeUsageEstimate`): once per task, `DASH plan set --five <points> --weekly <points> --why "<reason>"` in front of the first command. Past tasks come with the task text; `DASH plan history` shows more.

## Detailed updates (only with the `detailedUpdates` setting on)

`DASH run start "<title>" --plain "<plain sentence>" --steps "a::plain|b::plain" --eta 20m`, `DASH step start <n> --eta 4m --subs "x~2m|y~90s"`, `DASH sub done`, `DASH now "<text with 3 of 9 or 40%>"`, `DASH eta 6m [--total]`, `DASH step done|fail`, `DASH run done|fail --summary "..."`, `DASH job start|done|fail <name> --eta 3m`, `DASH ci-eta "<workflow>" 6m`.

## Usage log

`DASH insights [--days 7]` prints a short report of the local log `~/.agent-dashboard/usage-insights.jsonl` (never sent anywhere): model calls and tokens per turn, tool calls by kind, calls made only for the dashboard, the biggest outputs, and the text the hooks added. Read it before making the dashboard cheaper.

## Switches (`DASH settings set <key> on|off`, or the gear in the dashboard)

`claudeGuide` (on), `detailedUpdates` (off), `taskReminder` (off), `todoReminders` (off), `runReminders` (off), `claudeUsageEstimate` (on), `usageInsights` (on, free).

Dashboard texts: simple English.
