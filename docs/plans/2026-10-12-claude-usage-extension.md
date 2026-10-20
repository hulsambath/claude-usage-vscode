# Claude Usage Monitor (VS Code extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only VS Code extension that shows, for every Claude Code conversation window, how many tokens it has used, and shows the subscription's 5-hour (and 7-day) quota with its reset time.

**Architecture:** Three local data sources, no network calls and no credentials:
1. `~/.claude/projects/<slug>/<sessionId>.jsonl` (+ `<sessionId>/subagents/*.jsonl`) — transcripts; every `type: "assistant"` line carries `message.usage`. Streaming writes the same message several times, so usage is deduplicated by `message.id + requestId`.
2. `~/.claude/sessions/<pid>.json` — one file per running Claude Code window (`sessionId`, `cwd`, `name`, `status`, `updatedAt`). A file whose pid is dead is stale.
3. The official quota is only exposed to the **status line command** on stdin as `rate_limits.five_hour|seven_day.{used_percentage, resets_at}` (epoch seconds; present for subscribers after the first API response). A tiny zero-dependency Node bridge script is installed as the `statusLine` command; it writes `~/.claude/usage-monitor/sessions/<session_id>.json` atomically and prints a short status line (`5h 42% · ctx 31%`).

The extension polls these (default every 10 s, plus a file watcher on the bridge directory), aggregates them in pure modules, and renders a status-bar item and an activity-bar tree view. When no official quota is available it falls back to a locally computed 5-hour block (ccusage-style: block starts at the first message at least 5 h after the previous block start, floored to the hour) with token counts only.

**Tech Stack:** TypeScript 5, VS Code API `^1.90`, Node 22 (`.tool-versions`), vitest for unit tests, `tsc` build, `@vscode/vsce` for packaging to `.vsix`. No runtime dependencies.

**Spec:** the user request (2026-10-12): "build a local extension to support my claude usage for each window of conversations, and view the 5h quota". This plan is the spec.

## Global Constraints

- Local only: never read `~/.claude/.credentials*`, the keychain, or call any network API.
- Zero runtime dependencies (devDependencies only); the bridge script is plain CommonJS JS runnable with `node`.
- Never overwrite an existing `statusLine` in `~/.claude/settings.json`; installing the bridge requires an explicit modal confirmation.
- Pure logic (parsing, aggregation, formatting, settings planning) lives in modules that do not import `vscode`, so vitest can test them.
- Malformed JSON lines/files are skipped, never thrown to the UI.

## Review Focus

1. Duplicate assistant lines for one message (streamed blocks) → counted once (Task 2 test `dedupes repeated message ids`).
2. A transcript's last line is half-written while Claude is typing → that line is skipped, totals of complete lines still shown (Task 2 test `skips malformed lines`).
3. A quota snapshot whose `resets_at` has passed → shown as "reset — waiting for next response", not the stale % (Task 3 test `drops expired windows`).
4. Session files of closed windows (dead pid) → not listed as live (Task 4 test `filters dead pids`).
5. User already has a `statusLine` / has no `settings.json` → never clobbered / created cleanly (Task 5 tests).

---

## File Structure

```
claude-usage-vscode/
  package.json            extension manifest (commands, views, settings) + scripts
  tsconfig.json
  vitest.config.ts
  .vscodeignore .gitignore .tool-versions README.md
  bridge/statusline-bridge.js   status line command; exports handle() for tests
  src/types.ts            shared types
  src/paths.ts            ~/.claude path helpers (overridable root for tests)
  src/transcript.ts       parseTranscript(text) -> SessionUsage (pure)
  src/rateLimits.ts       pickRateLimits(snapshots, nowMs) (pure)
  src/liveSessions.ts     parseLiveSessions(files, isAlive) (pure)
  src/blocks.ts           currentBlock(events, nowMs) (pure)
  src/settingsPlan.ts     planStatusLineInstall(settingsText, command) (pure)
  src/format.ts           formatTokens, formatDuration, formatPercent (pure)
  src/collector.ts        filesystem reads + mtime cache -> UsageSnapshot
  src/statusBar.ts        status bar item (vscode)
  src/tree.ts             TreeDataProvider (vscode)
  src/extension.ts        activate(): wiring, polling, commands
  test/*.test.ts
```

## Shared types (`src/types.ts`)

```ts
export interface TokenTotals { input: number; output: number; cacheRead: number; cacheWrite: number; messages: number }
export interface UsageEvent { at: number; model: string; tokens: TokenTotals } // one deduped assistant message
export interface SessionUsage { sessionId: string; title?: string; cwd?: string; firstAt?: number; lastAt?: number;
  totals: TokenTotals; byModel: Record<string, TokenTotals>; events: UsageEvent[] }
export interface LiveSession { pid: number; sessionId: string; cwd: string; name: string; status: string; updatedAt: number }
export interface RateWindow { usedPercentage: number; resetsAt: number /* epoch s */ }
export interface RateLimits { fiveHour?: RateWindow; sevenDay?: RateWindow; observedAt: number; sessionId: string }
export interface BridgeSnapshot { session_id: string; session_name?: string; cwd?: string; model?: string;
  context_used_percentage?: number | null; rate_limits?: { five_hour?: { used_percentage: number; resets_at: number };
  seven_day?: { used_percentage: number; resets_at: number } }; written_at: number /* ms */ }
export interface BlockUsage { start: number; end: number; totals: TokenTotals }
export interface SessionView { live?: LiveSession; usage?: SessionUsage; bridge?: BridgeSnapshot; inWorkspace: boolean }
export interface UsageSnapshot { sessions: SessionView[]; rateLimits?: RateLimits; block?: BlockUsage; bridgeInstalled: boolean; takenAt: number }
```

### Task 1: Scaffold + formatting helpers

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.vscodeignore`, `src/types.ts`, `src/format.ts`, `test/format.test.ts`.

- [ ] Tests: `formatTokens(999)="999"`, `formatTokens(12_345)="12.3k"`, `formatTokens(4_200_000)="4.2M"`; `formatDuration(0)="0m"`, `formatDuration(65*60_000)="1h 05m"`, negative → `"0m"`; `formatPercent(41.6)="42%"`.
- [ ] Run `npx vitest run test/format.test.ts` → fails (module missing); implement; passes.
- [ ] `npx tsc -p . --noEmit` clean. Commit `chore: scaffold extension and formatting helpers`.

### Task 2: Transcript parser

**Files:** `src/transcript.ts`, `test/transcript.test.ts`.
**Produces:** `parseTranscript(text: string, sessionId: string): SessionUsage`, `mergeUsage(a: SessionUsage, b: SessionUsage): SessionUsage` (adds subagent usage).

- [ ] Tests:
  - sums `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` across assistant lines; `messages` = unique messages.
  - `dedupes repeated message ids`: three lines with the same `message.id`+`requestId` count once (use the last occurrence, which has final usage).
  - `skips malformed lines`: a truncated trailing line and a non-JSON line are ignored.
  - ignores `<synthetic>` model lines and lines without usage.
  - `byModel` splits by `message.model`; `firstAt`/`lastAt` from `timestamp`; `title` from the last `ai-title` line's `aiTitle`; `cwd` from first line carrying `cwd`.
  - `mergeUsage` adds totals and concatenates events.
- [ ] Red → implement → green. Commit `feat: parse Claude Code transcripts into deduped token usage`.

### Task 3: Rate-limit selection

**Files:** `src/rateLimits.ts`, `test/rateLimits.test.ts`.
**Produces:** `pickRateLimits(snaps: BridgeSnapshot[], nowMs: number): RateLimits | undefined`.

- [ ] Tests: picks the most recently written snapshot that has a non-expired `five_hour`; `drops expired windows` (`resets_at*1000 <= now` → that window omitted; both expired → `undefined`); keeps `seven_day` independently from the freshest snapshot carrying a live one; snapshots without `rate_limits` ignored.
- [ ] Red → implement → green. Commit `feat: select freshest live 5h/7d quota from bridge snapshots`.

### Task 4: Live sessions + local 5h block

**Files:** `src/liveSessions.ts`, `src/blocks.ts`, tests for both.
**Produces:** `parseLiveSessions(files: {name: string; text: string}[], isAlive: (pid: number) => boolean): LiveSession[]` (sorted by `updatedAt` desc); `currentBlock(events: UsageEvent[], nowMs: number): BlockUsage | undefined`.

- [ ] liveSessions tests: parses valid files; `filters dead pids`; skips malformed JSON and files lacking `sessionId`; dedupes the same sessionId (keeps newest `updatedAt`).
- [ ] blocks tests: events sorted; block start = first event floored to the UTC hour; an event ≥5 h after the block start or after a 5 h gap starts a new block; returns the block containing `now` (`now < end`) or `undefined` if the last block has ended; totals sum only events in that block.
- [ ] Red → implement → green. Commit `feat: live session discovery and local 5h block estimate`.

### Task 5: Status line bridge + safe install plan

**Files:** `bridge/statusline-bridge.js`, `src/settingsPlan.ts`, `test/bridge.test.ts`, `test/settingsPlan.test.ts`.
**Produces:** bridge `handle(input: object, dir: string, nowMs: number): string` (writes `<dir>/sessions/<session_id>.json` via tmp+rename, returns the status line text); `planStatusLineInstall(settingsText: string | undefined, command: string): { action: 'install' | 'already' | 'conflict' | 'invalid'; text?: string; existing?: string }`.

- [ ] bridge tests (temp dir): writes snapshot with `session_id`, `rate_limits`, `context_used_percentage`, `written_at`; output `5h 42% · ctx 31%` with both, `ctx 31%` without quota; rejects path-unsafe `session_id` (anything outside `[A-Za-z0-9-]`) by writing nothing; never throws on `{}`.
- [ ] settingsPlan tests: `undefined` → install with `{"statusLine":{"type":"command","command":...}}`; existing settings keep other keys; same command → `already`; different command → `conflict` with `existing`; invalid JSON → `invalid`.
- [ ] Red → implement → green. Commit `feat: status line bridge that records the 5h quota locally`.

### Task 6: Collector

**Files:** `src/paths.ts`, `src/collector.ts`, `test/collector.test.ts`.
**Produces:** `class Collector { constructor(root: string, isAlive?: (pid:number)=>boolean); collect(workspaceFolders: string[], scope: 'workspace'|'all', nowMs: number): Promise<UsageSnapshot> }`.

- Reads live sessions; for each, finds `projects/*/<sessionId>.jsonl` and merges `projects/*/<sessionId>/subagents/*.jsonl`; caches parsed usage by `path+mtimeMs+size`.
- Also includes recently active non-live sessions (transcript mtime within the last 5 h) so the block estimate and closed windows of the current block are visible; those have no `live`.
- `inWorkspace` = session cwd equals or is under any workspace folder. With scope `workspace`, non-workspace sessions are dropped from `sessions` but still count toward `block`.
- `bridgeInstalled` = `settings.json` `statusLine.command` contains `statusline-bridge`.
- [ ] Test with a fixture `~/.claude`-shaped temp dir: two live sessions (one dead pid), transcripts in different slug dirs, a subagent file, a bridge snapshot → asserts sessions, merged totals, rateLimits, block, scope filtering, and that a second `collect` without file changes reuses the cache (spy on parse count).
- [ ] Commit `feat: collect sessions, usage and quota from ~/.claude`.

### Task 7: VS Code UI + commands, package and install

**Files:** `src/statusBar.ts`, `src/tree.ts`, `src/extension.ts`, `package.json` contributions, `README.md`.

- Status bar (left-aligned priority 100): `$(pulse) 5h 42% · 1h 05m` from official quota; fallback `$(pulse) 5h ~1.2M tok · 2h 10m` (local block); warning background ≥ `claudeUsage.warnAt` (default 80), error ≥ 95. Tooltip (MarkdownString): 5h + 7d with reset clock times, block tokens, live session count, hint to install bridge if missing. Click → focus the tree view.
- Tree view `claudeUsage.view` in its own activity-bar container: root `5-hour quota` (children: used %, resets in/at, 7-day, local block tokens) and `Conversations` (one node per session: label = session name / ai title, description = `● busy` / `idle` / `closed` + total tokens; children: input, output, cache read, cache write, messages, context %, models, last activity, cwd). Workspace sessions first.
- Commands: `claudeUsage.refresh`, `claudeUsage.installBridge` (copies `bridge/statusline-bridge.js` to `~/.claude/usage-monitor/statusline-bridge.js`, then runs `planStatusLineInstall`; `install` → modal confirm → backup `settings.json` to `settings.json.bak-claude-usage` → write; `conflict` → show the existing command and how to chain), `claudeUsage.openTranscript` (on a session node).
- Settings: `claudeUsage.refreshSeconds` (10), `claudeUsage.scope` (`workspace`), `claudeUsage.warnAt` (80).
- Polling via `setInterval`, plus `fs.watch` on `~/.claude/usage-monitor/sessions` (ignored if missing); refresh errors logged to an OutputChannel, never thrown.
- [ ] `npm run build` and `npx vitest run` green; `npx vsce package` produces `claude-usage-monitor-0.1.0.vsix`; `code --install-extension` it.
- [ ] Run the bridge against a sample stdin and check the snapshot file; install the bridge into the real settings (confirmed modal path is the command; done here via the same `planStatusLineInstall` in a script since the user asked for an end-to-end setup).
- [ ] Commit `feat: status bar and tree view for per-conversation usage and 5h quota`.
