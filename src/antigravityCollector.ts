import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { antigravityPaths, defaultAntigravityRoot } from './antigravityPaths';
import { AntigravityTranscriptData, parseAntigravityTranscript } from './antigravityTranscript';
import { SessionView, UsageEvent } from './types';

const RECENT_MS = 5 * 3_600_000;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  data: AntigravityTranscriptData;
}

interface RawSessionMeta {
  id: string;
  title: string;
  status: string;
  not_fully_idle: number;
  killed: number;
  last_modified_time: string;
  workspace_uris: string;
}

const isUnder = (path: string, folder: string) =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

function normalizeWorkspace(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return uri;
}

export class AntigravityCollector {
  parseCount = 0;
  private cache = new Map<string, CacheEntry>();
  readonly p: ReturnType<typeof antigravityPaths>;

  constructor(
    root: string = defaultAntigravityRoot(),
    private readonly execSqlite?: (cmd: string, args: string[]) => Promise<string>,
  ) {
    this.p = antigravityPaths(root);
  }

  async collect(
    workspaceFolders: string[],
    scope: 'workspace' | 'all',
    nowMs: number,
  ): Promise<{ sessions: SessionView[]; events: UsageEvent[] }> {
    const rawSessions = await this.discoverSessions();
    const views: SessionView[] = [];
    const events: UsageEvent[] = [];

    for (const raw of rawSessions) {
      const transcriptPath = join(this.p.brain, raw.id, '.system_generated', 'logs', 'transcript.jsonl');
      const s = await stat(transcriptPath).catch(() => undefined);
      if (!s) continue;

      const lastModifiedMs = raw.last_modified_time ? Date.parse(raw.last_modified_time) : s.mtimeMs;
      const isRecent = nowMs - lastModifiedMs <= RECENT_MS || nowMs - s.mtimeMs <= RECENT_MS;
      const isBusy = raw.status === 'CASCADE_RUN_STATUS_RUNNING' || raw.not_fully_idle === 1;

      if (!isRecent && !isBusy) continue;

      const data = await this.parseCached(transcriptPath, raw.id);
      if (!data) continue;

      events.push(...data.usage.events);

      // Parse workspace paths
      let sessionCwd = '';
      try {
        const uris = JSON.parse(raw.workspace_uris);
        if (Array.isArray(uris) && uris.length > 0 && typeof uris[0] === 'string') {
          sessionCwd = normalizeWorkspace(uris[0]);
        }
      } catch {
        if (typeof raw.workspace_uris === 'string' && raw.workspace_uris.trim()) {
          sessionCwd = normalizeWorkspace(raw.workspace_uris);
        }
      }

      if (!sessionCwd && data.filesTouched.length > 0) {
        sessionCwd = data.filesTouched[0];
      }

      const inWorkspace = sessionCwd !== '' && workspaceFolders.some((f) => isUnder(sessionCwd, f));

      const state: 'busy' | 'idle' | 'closed' = isBusy
        ? 'busy'
        : raw.killed === 1
          ? 'closed'
          : nowMs - lastModifiedMs < 10 * 60_000
            ? 'idle'
            : 'closed';

      const contextSize = 1_000_000;
      const contextTokens = data.contextTokens;
      const contextUsedPct = contextTokens !== undefined ? (contextTokens / contextSize) * 100 : undefined;

      views.push({
        sessionId: raw.id,
        agent: 'antigravity',
        title: raw.title || data.firstUserPrompt?.slice(0, 60),
        live: {
          pid: 0,
          sessionId: raw.id,
          cwd: sessionCwd,
          name: raw.title || raw.id.slice(0, 8),
          status: state,
          updatedAt: lastModifiedMs,
        },
        usage: {
          ...data.usage,
          title: raw.title,
          cwd: sessionCwd,
        },
        bridge: {
          session_id: raw.id,
          session_name: raw.title,
          cwd: sessionCwd,
          model: data.model,
          context_window_size: contextSize,
          context_tokens: contextTokens,
          context_used_percentage: contextUsedPct,
          written_at: lastModifiedMs,
        },
        transcriptPath,
        inWorkspace,
        filesTouched: data.filesTouched,
        commandsRun: data.commandsRun,
        userPrompt: data.firstUserPrompt || data.lastUserPrompt,
        lastThinking: data.lastThinking,
      });
    }

    const filtered = scope === 'workspace' ? views.filter((v) => v.inWorkspace) : views;
    return { sessions: filtered, events };
  }

  private async parseCached(path: string, sessionId: string): Promise<AntigravityTranscriptData | undefined> {
    const s = await stat(path).catch(() => undefined);
    if (!s) return undefined;
    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.data;
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
    this.parseCount++;
    const data = parseAntigravityTranscript(text, sessionId);
    this.cache.set(path, { mtimeMs: s.mtimeMs, size: s.size, data });
    return data;
  }

  private async discoverSessions(): Promise<RawSessionMeta[]> {
    // Attempt 1: sqlite3 CLI query
    try {
      const json = await this.querySqlite(
        'SELECT conversation_id as id, title, status, not_fully_idle, killed, last_modified_time, workspace_uris FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 40;',
      );
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fallback below
    }

    // Attempt 2: Direct filesystem scan of brain directory
    return this.discoverFromDisk();
  }

  private querySqlite(sql: string): Promise<string> {
    if (this.execSqlite) {
      return this.execSqlite('sqlite3', ['-json', this.p.conversationSummariesDb, sql]);
    }
    return new Promise((resolve, reject) => {
      execFile(
        'sqlite3',
        ['-json', this.p.conversationSummariesDb, sql],
        { timeout: 3000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });
  }

  private async discoverFromDisk(): Promise<RawSessionMeta[]> {
    const list: RawSessionMeta[] = [];
    let entries: string[] = [];
    try {
      entries = await readdir(this.p.brain);
    } catch {
      return [];
    }

    for (const name of entries) {
      const lockPath = join(this.p.presence, `${name}.lock`);
      const lockStat = await stat(lockPath).catch(() => undefined);
      const brainStat = await stat(join(this.p.brain, name)).catch(() => undefined);
      const mtime = lockStat?.mtimeMs || brainStat?.mtimeMs || Date.now();

      list.push({
        id: name,
        title: '',
        status: lockStat ? 'CASCADE_RUN_STATUS_RUNNING' : 'CASCADE_RUN_STATUS_IDLE',
        not_fully_idle: lockStat ? 1 : 0,
        killed: 0,
        last_modified_time: new Date(mtime).toISOString(),
        workspace_uris: '[]',
      });
    }

    return list.sort((a, b) => Date.parse(b.last_modified_time) - Date.parse(a.last_modified_time));
  }
}
