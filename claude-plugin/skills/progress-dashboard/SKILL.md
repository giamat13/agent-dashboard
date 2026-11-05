---
name: progress-dashboard
description: Keep the user's VS Code dashboard up to date. Use at the start of every task with 2 or more steps (create the TODO list first and update it as you go), and before any test suite, build, install, migration or script that may take more than 30 seconds (steps, status, estimated time).
---

# Progress Dashboard

The user watches a dashboard in VS Code and often cannot tell whether a long script is progressing. Your job: keep it truthful and understandable to a non-technical person.

The exact `dash.js` path is printed in the session-start context ("Agent Dashboard is ON"). It is also `${CLAUDE_PLUGIN_ROOT}/scripts/dash.js`. Below, `DASH` = `node "<path>/dash.js"`.

## Every task with 2+ steps

First thing, before other work: create the TODO list (`TodoWrite`/`TaskCreate`; without them: `DASH todo set "[~] current|next|another"`). Mark a step `in_progress` when you start it and `completed` right after. A one-step task needs no list.

## Flow for a long command

1. **Plan before running.** Split the work into 3-7 steps; each with a plain explanation.
   `DASH run start "Full tests" --plain "Checking the app still works after the changes" --steps "Setup::Preparing the environment|Unit tests::Checking small parts|Full tests::Checking the whole flow end to end|Summary::Collecting the results" --eta 25m`
2. **Start each step** with an ETA and sub-steps when you know them.
   `DASH step start 2 --plain "Checking each function on its own" --eta 6m --subs "Users|Payments|Reports"`
3. **Run the command in the background** and check its output every 1-2 minutes. At EVERY check, update:
   - `DASH now "Payment checks are running, 40 of 120 passed"` (what is happening, simple words)
   - `DASH eta 4m` (estimate **from now** for the current step; revise it honestly)
   - `DASH sub done` when a sub-step finishes
4. `DASH step done` (or `step fail "reason"`), then the next step.
5. Finish: `DASH run done --summary "Everything passed, 120 tests"` or `run fail --summary "..."`.

## Writing rules

- Write in English, short sentences, no jargon ("We are checking that payments still work" not "executing integration suite").
- ETA must be a real estimate (based on progress so far), not a constant. If unknown, say so in `now` and give a rough range.
- Never leave the dashboard silent for more than ~2 minutes while a script runs; the extension flags that as "possibly stuck".
- TODOs and context usage sync automatically; nothing to do for them.
