# Changelog

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
