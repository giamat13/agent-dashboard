# Changelog

## 0.4.21
- The planned usage is back on the usage card: the 5-hour and weekly limit bars show a dashed line at the share the running task is expected to reach when it ends. A task is the whole TODO list of a session: it starts when an item is in progress and is recorded when every item is completed. The estimate is the median of the last 10 finished tasks, kept in `.agent-dashboard/planned.json`. No line shows until a task has finished once.

## 0.4.20
- The planned usage is removed: the limit bars no longer show a planned share, and the usageEstimate and usageRecord switches are gone. The 5-hour and weekly limits still show, and `dash.js usage` still prints them.

## 0.4.19
- The COMPACT CHAT button is removed, with its request file and the plugin module that only served it. Sessions no longer poll for compact requests.

## 0.4.18
- The COMPACT CHAT messages and tooltip are in English again, like the rest of the dashboard.

## 0.4.17
- The COMPACT CHAT messages and tooltip are in Hebrew.

## 0.4.16
- COMPACT CHAT runs `/compact` in its chat by itself, as the context dashboard does. The button writes a request into the project's `.agent-dashboard` folder; the Agent Dashboard plugin in that chat (`hooks/register.ts`) runs `/compact` once the chat is free and writes the result back. Needs the plugin updated (`claude plugin update agent-dashboard@agent-dashboard`) and a Reload Window.

## 0.4.15
- COMPACT CHAT opens this chat with `/compact` already typed in, instead of copying it. The Claude extension cannot send a message from outside, so press Enter once to run it.

## 0.4.14
- Agent memory card: a COMPACT CHAT button. It copies `/compact` and opens the Claude chat. VS Code cannot type into the chat for the dashboard, so paste it there (Ctrl+V) and press Enter.

## 0.4.13
- Screenshots Claude read are kept per session: the Screenshots card shows only the pictures of the session on screen, never those of another session. The all-sessions tab shows no screenshots.

## 0.4.12
- The striped planned part on the usage bar now ends at the same point as the "planned at 100%" text. Before, it could show a much shorter part when a limit reset during the task.
- Screenshots open full screen when clicked, by default. Turn "Screenshots full screen" off in the settings to enlarge a picture inside its card, as before.

## 0.4.11
- Planned usage covers the whole task: the whole TODO list, from its first item in progress until every item is completed. One estimate and one record per task, not per item. Similar tasks are matched on the text of the whole list.
- Progress ring on a TODO list counts the whole list: finished items, plus the item in progress with the progress of its running script. Without a TODO list it shows the script's steps, as before.
- The Activity and Agent tasks cards follow their switches in the settings, like the other cards.

## 0.4.10
- Settings: "Screenshots full screen" (off by default). When on, a click on a screenshot opens it over the whole dashboard; click or press Esc to close it. When off, a click enlarges it inside its card, as before.

## 0.4.9
- Every card has its own switch in the settings popover (Activity, Agent tasks, Parallel jobs, Agent memory, Claude usage limits, Codex and Copilot limits, Run history, Output). All are on except Output, which is off by default.
- The GitHub Actions card is removed from the dashboard, and its switch with it. The local API still reports GitHub runs; the `githubActions` key in `~/.agent-dashboard/settings.json` still turns that off.

## 0.4.8
- The Claude instructions: when one run has several tests or checks, each one is its own sub-step on the dashboard (marked done as it passes).

## 0.4.7
- Screenshots: click a picture to enlarge it to the full width of the card; click again to shrink it.

## 0.4.6
- Planned usage on the usage card shows the share expected when the task reaches 100%: where it started plus the estimate (for example "planned at 100%: ~60%"). The striped part on the bar is unchanged.

## 0.4.5
- Empty cards are left out: a card with nothing to show (no tasks, no activity, no memory data, no usage numbers, no GitHub runs) does not appear.
- The usage card has a Compact / Full button. Compact shows each limit on one line with its reset time; the choice is remembered in the window.
- Settings: "Show screenshots Claude reads" (off by default). When Claude reads a PNG or JPG file, a copy goes to `.agent-dashboard/shots` in the project (never in git) and the picture is shown in a Screenshots card. The last 6 are kept.
- Planned usage keeps working while Anthropic limits the usage checks: a task starts from the last numbers read (up to 20 minutes old, shown as "limits read earlier"). Such a task does not add to the usage history.
- The Claude instructions say when to mark a task in_progress and completed, which is what records planned usage.

## 0.4.4
- Google Antigravity is a supported agent: its sessions show the Antigravity icon, and `dash.js agent-setup antigravity` prints the hook setup for `~/.gemini/config/hooks.json`. The dashboard writes no files for it.
- No usage limits card for Antigravity: Google publishes no numeric limits, and there is no local file to read them from.

## 0.4.3
- The sidebar icon of the extension is removed. Open the dashboard from the status bar item ("Agents") or with "Agent Dashboard: Open in large window".

## 0.4.2
- The names say Agent instead of Claude: the panel is "Agent Dashboard", and the headings are "Agent tasks" and "Agent memory".
- Each session shows an icon for the agent that runs it: Claude, Codex or GitHub Copilot. Sessions saved before this show the Claude icon.
- Usage card: when Anthropic limits the checks, a short text is shown instead of the raw HTTP error. The last numbers stay if they were read before.

## 0.4.1
- Codex and GitHub Copilot limits in the panel, for paid plans only. A limit that exists only on the free plan is not shown, so on a free plan there is no card. Codex: the 5-hour and weekly limits from its local session files. Copilot: the premium-request allowance, read through the GitHub CLI (`gh`) about every five minutes.
- Progress for Codex and Copilot: `dash.js agent-setup codex` and `dash.js agent-setup copilot` print the hook settings and the instructions to add. The dashboard writes no files for them.
- The hook takes `--agent` and `--event` for the other agents. Claude Code works as before.

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
