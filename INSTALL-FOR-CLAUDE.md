# Installing Agent Dashboard (instructions for Claude)

If the user asked you to install Agent Dashboard, follow these steps in order. Run long commands in the background. Report each step's result to the user in their language.

Agent Dashboard has two parts that share `.agent-dashboard/state.json` in each project folder:

- **Claude Code plugin** (`claude-plugin/`): hooks and the `dash.js` / `wrap.js` scripts that Claude uses to report progress.
- **VS Code extension** (`vscode-extension/`): the live dashboard panel.

## 0. Check what is already installed

```
claude plugin list
code --list-extensions --show-versions
```

Look for `agent-dashboard@agent-dashboard` and `giamat13.agent-dashboard`. If both are present and current, skip to step 4.

## 1. Get the source

Use a local folder you can keep (the plugin marketplace points at it):

```
git clone https://github.com/GIAMAT13/agent-dashboard
```

If the user already has the folder, run `git pull` inside it instead.

## 2. Install the Claude Code plugin

```
claude plugin marketplace add <path-to>/agent-dashboard
claude plugin install agent-dashboard@agent-dashboard
```

(`marketplace add GIAMAT13/agent-dashboard` also works once the repo is public on GitHub.)

To update later: `claude plugin marketplace update agent-dashboard` then `claude plugin update agent-dashboard@agent-dashboard`. A plugin only updates when its `version` in `claude-plugin/.claude-plugin/plugin.json` changes.

## 3. Install the VS Code extension

```
cd <path-to>/agent-dashboard/vscode-extension
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension agent-dashboard-<version>.vsix --force
```

`<version>` is the `version` in `vscode-extension/package.json`. The command prints the exact file name.

## 4. Make Claude use it in every project (user-level instructions)

Add this section to the user's global `~/.claude/CLAUDE.md` (create the file if missing). Replace `<path-to>` with the real absolute path of the cloned folder, using forward slashes:

```markdown
## Progress dashboard (agent-dashboard)

Always, in every project, use the dashboard without being asked:

- At the start of any task with 2+ steps, before other work, create the TODO list (TodoWrite/TaskCreate/TaskUpdate). Mark a step in_progress when you start it and completed right after. If those tools do not exist, use `node "<path-to>/agent-dashboard/claude-plugin/scripts/dash.js" todo set "[~] current|next|another"`.
- Every build, test, install, migration, packaging step or script (do not judge by duration; only bare `ls`/`pwd`/`echo`/`cat`/`git status|log|diff` are exempt): wrap it with `wrap.js` and run the wrapper in the background, or report with `dash.js` (`run start`, `step`, `now`, `eta`, `run done|fail`) and update at every check of the output.
- The scripts are always in `<path-to>/agent-dashboard/claude-plugin/scripts/`, even if the SessionStart hook did not inject instructions.
- Dashboard texts are written in simple English.
```

Do not overwrite the user's existing content. Append, or merge into an existing section.

## 5. Tell the user what to do next

1. VS Code: run **Developer: Reload Window**.
2. Open a **new** Claude Code chat. Sessions that were already open do not pick up new hooks.
3. Open the **Claude Dashboard** icon in the VS Code activity bar.

## 6. Verify

In a project folder, run:

```
node "<path-to>/agent-dashboard/claude-plugin/scripts/dash.js" todo set "[~] Test item|Second item"
```

The dashboard should show a "Claude's tasks" card with two items within a second or two. Then clean up with `dash.js todo set ""` or just continue working.

If nothing appears:

- `.agent-dashboard/state.json` should exist in the project folder. If it does not, the plugin hooks are not running: check `claude plugin list` and open a new chat.
- Make sure the VS Code window has that same folder open.
- Add `.agent-dashboard/` to the project's `.gitignore`.

## Notes

- Install the dashboard itself only from this repository; in other projects only use it.
- Do not create git branches or push unless the user explicitly asks.
