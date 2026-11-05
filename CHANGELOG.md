# Changelog

## 0.4.0
- The VS Code extension updates itself: about 20 seconds after it starts, and then every hour, it checks GitHub Releases, verifies the file's checksum and installs a newer version. Reload the window to use it. "Agent Dashboard: Check for updates" checks now.
- The Claude plugin updates itself once a day in the background. The first session after an update says so; restart Claude Code to use it.
- GitHub Actions card: the latest runs of this repository, with the time left for a running workflow. GitHub Pages runs are shown small. `dash.js ci-eta "<workflow>" <time>` sets the usual time of one workflow.
- Local API on 127.0.0.1 only, read-only, for other tools. `dash.js status` shows its address. Requests from web pages (with an Origin header) and other host names are refused.
- Switches in the settings card: GitHub Actions, local API, extension auto-update and plugin auto-update (saved in `~/.agent-dashboard/settings.json`).
- Release workflow: on every push to main, a new extension version is published as a GitHub release with the `.vsix` and its checksum.

## 0.3.31
- Planned usage: when a task starts, the dashboard estimates how much of the 5-hour and weekly limits it will use, from similar finished tasks (same model first). The planned part is a striped piece on the limit bars, with its size in the text.
- Each finished task is recorded with the usage it used, so the estimate gets better over time. Two switches in the settings card turn the estimate and the recording off separately.
- `dash.js usage` shows the limits, the running task and its expected usage (`--json` for scripts).
- `dash.js ci-eta "<job>" <time>` sets an expected time for a CI job (`ci-eta clear "<job>"` removes it).
- Settings card (gear button): switches saved in `~/.agent-dashboard/settings.json`, shared by the extension and the plugin.

## 0.3.30
- "All sessions" tab: follow every Claude session of this project at once. Tasks are grouped by session (with that session's goal), every running run is listed, and each chat's memory is shown side by side.
- Run history stays open.
- The packaged extension no longer includes log files.

## 0.3.29
- Total left: when Claude's total does not cover the steps still to do, the dashboard counts the time from the steps and says so ("total not updated, calculated from the steps"). A step's own estimate counts before its history.
- Time estimates on TODO items are optional.
- Claude keeps the dashboard live all the time: TODO, now and eta are updated at every step change and output check.

## 0.3.x
- Progress percentage follows counts in status lines ("33 of 36", "45%"); the first step of a run starts automatically.
- Mid-task nudge: if open tasks are not updated for 5 tool calls, Claude gets a short reminder to update the list.
- A short reminder on every prompt while the session has no open tasks, so Claude keeps the dashboard updated in every project.
- Usage card: Claude 5-hour and weekly limits (percent used and time until reset).
- New UI: tiles (progress, total left, now, numbers), dynamic pipeline, live activity log, tasks card, parallel jobs, output card, run history.
- Stages are dynamic: reported by Claude or the script (`--steps`, `@@step`, `@@job`).
- Time estimates learned from previous runs.
- `/goal` is shown at the top; `dash.js goal`, `dash.js reset`.
- Several Claude sessions in the same project: tabs, each with its own tasks, goal and context.

## 0.2.x
- Unified to-do list and script progress, context bar up to auto-compact, TODO fallback without TodoWrite.

## 0.3.23
- Sub-steps take their own time estimate (name~2m), with time left and time taken
- Claude tasks show estimates (item ~5m), time left and time taken

## 0.3.24
- Fully autonomous rules: continuous updates, estimates on every task, Claude splits steps into sub-steps itself

## 0.3.25
- Parallel jobs: estimate from --eta, history, or the average of finished jobs; "no estimate yet" shown otherwise

## 0.3.26
- Warning banner (and CLI WARNING) when a step estimate is longer than the total, or sub-steps add up to more than their step

## 0.3.27
- While the dashboard panel is open the window title shows only the project name; the previous setting is restored when it closes

## 0.3.28
- Project-only window title applies only while the dashboard is the active editor; other editors show the normal title
