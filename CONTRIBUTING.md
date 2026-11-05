# Contributing

Thanks for helping! The project has two parts that share `.agent-dashboard/state.json`:

- `claude-plugin/` – hooks and the `dash.js` / `wrap.js` CLI (Node.js, no dependencies).
- `vscode-extension/` – the VS Code webview (`media/main.js`, `media/main.css`) and `extension.js`.

## Develop
1. Edit the files, then package: `cd vscode-extension && npx @vscode/vsce package`.
2. Install: `code --install-extension agent-dashboard-<version>.vsix --force`, then reload the window.
3. Plugin changes need a version bump in `claude-plugin/.claude-plugin/plugin.json` to be picked up by `claude plugin update`.

## Guidelines
- No runtime dependencies; keep scripts plain Node.js.
- Dashboard texts are in English. Stages must stay dynamic (nothing project-specific hard-coded).
- Test with a small script using `wrap.js` before opening a pull request.
- Never commit `.agent-dashboard/` (it holds local state and logs).

Licensed under MIT (see LICENSE).
