# Claude & Antigravity Usage Monitor + Context Bridge

A local-only VS Code extension that tracks **Claude Code** and **Antigravity** AI token usage, session activity, context window limits, and solves context loss when switching between agents with a **1-click Cross-Agent Context Bridge**.

![Claude & Antigravity Usage Monitor: quota card, multi-agent conversations list, and context bridge](docs/preview.png)

- **Cross-Agent Context Bridge (No More Missing Context):**
  - When switching between Claude Code and Antigravity, click **📋 Copy Handoff Prompt** or **💾 Save Bridge File (`.agent-handoff.md`)**.
  - Automatically extracts:
    - User goal & initial instructions
    - Files modified / created in the session
    - Terminal commands executed
    - Latest agent reasoning, findings, and current state
    - Clean markdown instructions tailored for the receiving agent
- **Multi-Agent Monitoring:**
  - Full support for both Claude Code (`~/.claude`) and Antigravity (`~/.gemini/antigravity-cli`).
  - Filter tabs in the sidebar: `All Agents` | `Claude` | `Antigravity`.
  - Visual badges distinguishing each agent with status indicators (Working/Busy, Idle, Closed).
- **Status bar:** `34% left · AGY 326k · 2h 23m`: Shows live status for Claude quota, Antigravity activity, combined tokens, and active working state.
- **Sidebar (gauge icon):**
  - **Quota & Usage:** Claude's 5-hour quota gauge + Antigravity's 5-hour token metrics and active session counts.
  - **Conversations:** Real-time list of all open and recent conversations from both agents. Each card displays tokens, context window usage (e.g. "813.4k of 1.0M context tokens left"), modified files count, and expandable breakdown with 1-click **Open transcript** and **Handoff to other agent**.

## Where the numbers come from

Everything is read purely locally from your machine:

| Data | Source |
|---|---|
| Claude Open windows | `~/.claude/sessions/<pid>.json` (dead pids ignored) |
| Claude Tokens per conversation | `~/.claude/projects/*/<session>.jsonl` + `<session>/subagents/*.jsonl` |
| Claude 5h / 7d quota, context | `bridge/statusline-bridge.js` writing to `~/.claude/usage-monitor/sessions/<session>.json` |
| Antigravity Sessions & Status | `~/.gemini/antigravity-cli/conversation_summaries.db` + `presence/*.lock` |
| Antigravity Tokens & Context | `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` |
| Files Touched & Actions | Parsed directly from transcript tool calls (`write_file`, `edit_file`, `Edit`, `Write`, `Bash`, `run_command`) |

## Commands

- **AI Usage: Show Usage**: Focuses the usage and context sidebar.
- **AI Usage: Copy Agent Context Handoff**: Generates and copies a rich prompt summarizing recent progress to paste into the other agent.
- **AI Usage: Save Context Bridge to Workspace**: Writes `.agent-handoff.md` to workspace root and opens it in editor.
- **Claude Usage: Install Status Line Bridge**: Sets up Claude's status line for official quota reporting.

## Develop

```bash
npm install
npm test            # vitest (17 suites, 92 unit tests)
npm run typecheck   # tsc type checking
npm run package     # -> claude-usage-monitor-0.4.0.vsix
code --install-extension claude-usage-monitor-0.4.0.vsix
```

Settings:
- `claudeUsage.antigravityEnabled` (default `true`)
- `claudeUsage.agentFilter` (`all` | `claude` | `antigravity`)
- `claudeUsage.refreshSeconds` (10)
- `claudeUsage.scope` (`workspace` | `all`)
- `claudeUsage.warnAt` (80)
