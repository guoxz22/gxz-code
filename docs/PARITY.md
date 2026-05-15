# GXZ-code Parity Plan

This file tracks Claude Code-style capability parity without copying the Claude Code source snapshot.

## Implemented

- CLI entrypoint with one-shot and interactive chat.
- Claude Code-style default terminal UI entrypoint with live assistant deltas and tool progress.
- Default TUI slash commands for `/context`, `/resume`, `/sessions`, `/save`, `/model`, `/provider`, `/config`, `/tools`, `/skills`, `/doctor`, `/compact`, `/status`, `/diff`, `/diagnostics`, `/mcp`, `/code-action`, `/review`, `/team`, `/pr`, `/permissions`, and `/exit`.
- FOX startup banner and `/dashboard` full-screen style status panel.
- Interactive TUI slash-command suggestions for built-in and custom commands, with Up/Down selection, Tab completion, and Enter-to-run behavior.
- TUI input history, Ctrl-R history search, newline entry basics, and Ctrl-C current-run interruption.
- `/effort` and `/effect` presets for low/medium/high/xhigh local reasoning depth.
- Local memory commands and memory loading from user/project/local files.
- Custom Markdown slash commands from user/project command folders.
- Local hook runtime for session, prompt, tool, and compaction events.
- Claude Code-inspired but independent GXZ system prompt for local terminal coding.
- Persistent sessions and session listing.
- Chat slash commands for config, model, tools, history, clear, save, and exit.
- Provider abstraction.
- GLM Coding Plan defaults.
- OpenAI-compatible chat completions adapter.
- Anthropic-compatible messages adapter.
- Model selection by command-line flag, environment, GLM aliases (`glm`, `turbo`, `air`), and Claude-style aliases (`opus`, `sonnet`, `haiku`) when using Anthropic credentials.
- Tool-call loop.
- File read, write, edit, list, and search tools.
- Patch preview/apply tool and `patch` CLI/TUI command with TUI preview-and-confirm flow.
- Todo checklist tool.
- Background monitor tool/command for long-running local commands.
- Git worktree tool/command for isolated local changes.
- Shell tool with conservative write-command gate.
- Web fetch tool.
- Permission policy file for tool and shell command allow/deny rules.
- Durable approval memory for TUI allow/deny decisions.
- Git status and diff helpers.
- Session transcript export and search.
- Workspace init command.
- Workspace instruction loading from `AGENTS.md`, `GXZ.md`, and `CLAUDE.md`.
- Local skills discovery plus `read_skill` tool.
- Context compaction command.
- Doctor diagnostics.
- MCP stdio and streamable HTTP server add/remove/list/test management, tool discovery, call bridge, resource reads, prompt retrieval, pooled model-tool clients, and MCP prompt slash suggestions.
- Subagent tool for bounded focused analysis.
- Team orchestration command with explicit task DAG support and default explore/plan/execute/verify flow.
- Diagnostics command/tool for typecheck-style checks.
- Lightweight file outline and workspace symbol search tools.
- LSP-style command/tool for action listing, JSON formatting, TypeScript diagnostics-backed actions, real stdio LSP code-action/hover/references requests, and workspace edit application foundation.
- Review command over current diff.
- PR/MR platform integration for GitHub and GitLab metadata/diff fetch plus dry-run or explicit publish comments.
- GitHub `gh` CLI helpers for PR view/diff/checks, issue view/list, and dry-run-gated write actions such as comments and issue creation.
- Commit command.
- Approximate session cost command.
- Optional interactive tool approval.
- Local HTTP bridge foundation for editor/external tool integration, plus VS Code extension scaffold.
- Config display with secret redaction.
- Basic test suite.

## Next Parity Milestones

1. Richer full-screen terminal UI: diff preview panes, broader keybindings, resume-after-interrupt ergonomics, and visual approval panels.
2. Broader real LSP operations for rename and richer workspace edit review/application.
3. Better edit engine: multi-file transactions, conflict detection, rollback, and merge-conflict helpers.
4. Cost and token accounting from provider-reported usage where available.

## Design Constraints

- Keep this implementation independent from the Claude Code source snapshot.
- Keep GLM as the first-class default while preserving provider portability.
- Never persist API keys.
- Prefer small, testable modules over monolithic CLI code.
