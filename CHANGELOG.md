# Changelog

## 0.3.x
- A short reminder on every prompt while the session has no open tasks, so Claude keeps the dashboard updated in every project.
- Usage card: Claude 5-hour and weekly limits (percent used and time until reset).
- New UI: tiles (progress, total left, now, numbers), dynamic pipeline, live activity log, tasks card, parallel jobs, output card, run history.
- Stages are dynamic: reported by Claude or the script (`--steps`, `@@step`, `@@job`).
- Time estimates learned from previous runs.
- `/goal` is shown at the top; `dash.js goal`, `dash.js reset`.
- Several Claude sessions in the same project: tabs, each with its own tasks, goal and context.

## 0.2.x
- Unified to-do list and script progress, context bar up to auto-compact, TODO fallback without TodoWrite.
