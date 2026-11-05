---
name: progress-dashboard
description: Keep the user's VS Code dashboard up to date. Use at the start of every task with 2 or more steps (create the TODO list first and update it as you go), and before EVERY test suite, build, install, migration, packaging step or script, whatever its expected duration (steps, status, estimated time).
---

# Progress Dashboard

The user watches a dashboard in VS Code and often cannot tell whether a long script is progressing. Your job: keep it truthful and understandable to a non-technical person.

The exact `dash.js` path is printed in the session-start context ("Agent Dashboard is ON"). It is also `${CLAUDE_PLUGIN_ROOT}/scripts/dash.js`. Below, `DASH` = `node "<path>/dash.js"`.

## Fully autonomous

The user never has to remind you or give instructions about the dashboard. Do all of this yourself, every time, without being asked:
- Create the TODO list in your first action. An estimate on a TODO item is optional (`Write tests ~5m`); sub-steps always get one.
- Break every step into small sub-steps yourself and give each its own estimate (`--subs "a~2m|b~90s"`), then run `sub start` / `sub done` as you go. Sub-steps are never optional.
- Update the dashboard continuously during the whole task (every step change, every output check, every plan change), not only at the start and end.
- Keep it live all the time: mark TODO items done/doing at every step change, update now/eta at every output check, and never go more than 5 tool calls without a dashboard update.
- Fix an estimate (`eta`, `sub start N --eta`) as soon as it proves wrong.

## Every task with 2+ steps

First thing, before other work: create the TODO list (`TodoWrite`/`TaskCreate`; without them: `DASH todo set "[~] current|next|another"`). Mark a step `in_progress` when you start it and `completed` right after. A one-step task needs no list.

## Every build, test, install or script

Do not decide whether it is "long enough". Wrap it: `node "<path>/wrap.js" --title "..." --plain "..." --steps "a::plain|b::plain" -- <command>` and run that in the background. Only bare `ls`/`pwd`/`echo`/`cat`/`git status|log|diff` and file reads are exempt.

## Flow for a long command

1. **Plan before running.** Split the work into 3-7 steps; each with a plain explanation.
   `DASH run start "Full tests" --plain "Checking the app still works after the changes" --steps "Setup::Preparing the environment|Unit tests::Checking small parts|Full tests::Checking the whole flow end to end|Summary::Collecting the results" --eta 25m`
2. **Start each step** with an ETA and sub-steps when you know them.
   `DASH step start 2 --plain "Checking each function on its own" --eta 6m --subs "Users|Payments|Reports"`
3. **Run the command in the background** and check its output every 1-2 minutes. At EVERY check, update:
   - `DASH now "Payment checks are running, 40 of 120 passed"` (what is happening, simple words)
   - `DASH eta 4m` (estimate **from now** for the current step; revise it honestly)
   - `DASH eta 9m --total` (time left for the **whole run**, from now; see "Total time left" below)
   - `DASH sub done` when a sub-step finishes
4. `DASH step done` (or `step fail "reason"`), then the next step.
5. Finish: `DASH run done --summary "Everything passed, 120 tests"` or `run fail --summary "..."`.

## Estimates on the smallest sub-steps

Give every sub-step its own estimate: `--subs "Users~2m|Payments~90s|Reports~30s"` (the part after `~`), or per sub-step `DASH sub start 2 --eta 90s`. In `wrap.js` output: `@@sub add Users~2m|Payments~90s`. Revise with `DASH sub start N --eta <time>` when you learn more. The dashboard shows "~time left" next to the running sub-step and moves the percentage with it.

## Estimates on parallel jobs

Every `job start <name>` gets `--eta 3m` (your best guess). Without it the "Running now" card shows only elapsed time. If you forget, the dashboard falls back to the average of finished jobs.

## GitHub Actions and usage

- A GitHub Actions run gets the usual time of its workflow. If a workflow usually takes a different time, set it: `DASH ci-eta "<workflow name>" 6m`. Remove it with `DASH ci-eta clear "<workflow name>"`. Use the name as GitHub shows it.
- `DASH usage` prints the Claude limits (5-hour and weekly) and the expected usage of the running task.

## Estimates must add up

A step estimate must not exceed the total estimate, and sub-steps must not add up to more than their step. The dashboard shows a warning banner and `dash.js` prints WARNING when they do not. When you see it, fix it right away (`eta <time> --total`, or lower the step/sub-step estimate).

## Total time left (the big number)

"Total left" on the dashboard is the time left for the WHOLE run, counted from now. Keep it true yourself:
- Give it when the run starts: `DASH run start ... --eta 25m`.
- Update it whenever the plan changes: a step starts or finishes, an estimate changes, a step or sub-step is added or dropped: `DASH eta 9m --total`.
- Scripts run with wrap.js: the total is set when the script starts. Correct it any time with `DASH eta 9m --total`, or print `@@total 9m` from the script.
- If dash.js prints `WARNING: the total time left is out of date` or the dashboard says "total not updated", fix it at once.

If your total is missing or too short, the dashboard works it out from the steps and says so. That is a fallback only: you still update the total.

## Estimates on the task list

An estimate on a TODO item is optional. Add one when it helps: `Write tests ~5m`, `Build ~2m`. The dashboard shows it (and time left / time taken) on the right of the task in "Claude's tasks".

## Progress percentage

The progress ring and bar move only when you report progress. Put a count or percentage in every `now` text, e.g. `DASH now "33 of 36 test suites finished"` or `"Download 45%"`; the dashboard turns it into the percentage of the current step. A run's first step starts automatically.

## Writing rules

- Write in English, short sentences, no jargon ("We are checking that payments still work" not "executing integration suite").
- ETA must be a real estimate (based on progress so far), not a constant. If unknown, say so in `now` and give a rough range.
- Never leave the dashboard silent for more than ~2 minutes while a script runs; the extension flags that as "possibly stuck".
- TODOs and context usage sync automatically; nothing to do for them.
