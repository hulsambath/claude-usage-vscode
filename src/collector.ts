import { readFile, readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { currentBlock } from './blocks';
import { windowTotals } from './estimate';
import { isPidAlive, parseLiveSessions } from './liveSessions';
import { paths } from './paths';
import { pickRateLimits } from './rateLimits';
import { mergeUsage, parseTranscript } from './transcript';
import { BridgeSnapshot, SessionUsage, SessionView, UsageEvent, UsageSnapshot } from './types';

const RECENT_MS = 5 * 3_600_000;
const BRIDGE_MAX_AGE_MS = 8 * 24 * 3_600_000;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  usage: SessionUsage;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

const isUnder = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** Reads ~/.claude and assembles one UsageSnapshot; transcripts are cached by mtime + size. */
export class Collector {
  parseCount = 0;
  private cache = new Map<string, CacheEntry>();
  private readonly p: ReturnType<typeof paths>;

  constructor(root: string, private readonly isAlive: (pid: number) => boolean = isPidAlive) {
    this.p = paths(root);
  }

  async collect(workspaceFolders: string[], scope: 'workspace' | 'all', nowMs: number): Promise<UsageSnapshot> {
    const live = await this.readLive();
    const liveIds = new Set(live.map((s) => s.sessionId));
    const transcripts = await this.findTranscripts(liveIds, nowMs);
    const bridges = await this.readBridges(nowMs);

    const ids = new Set([...liveIds, ...transcripts.keys()]);
    const views: SessionView[] = [];
    const events: UsageEvent[] = [];
    for (const id of ids) {
      const t = transcripts.get(id);
      const usage = t ? await this.usageFor(id, t) : undefined;
      if (usage) events.push(...usage.events);
      const liveSession = live.find((s) => s.sessionId === id);
      const bridge = bridges.find((b) => b.session_id === id);
      const cwd = liveSession?.cwd || usage?.cwd || bridge?.cwd || '';
      views.push({
        sessionId: id,
        live: liveSession,
        usage,
        bridge,
        transcriptPath: t,
        inWorkspace: cwd !== '' && workspaceFolders.some((f) => isUnder(cwd, f)),
      });
    }

    const lastActivity = (v: SessionView) => Math.max(v.live?.updatedAt ?? 0, v.usage?.lastAt ?? 0);
    views.sort(
      (a, b) =>
        Number(b.inWorkspace) - Number(a.inWorkspace) ||
        Number(!!b.live) - Number(!!a.live) ||
        lastActivity(b) - lastActivity(a),
    );

    const rateLimits = pickRateLimits(bridges, nowMs);
    return {
      sessions: scope === 'workspace' ? views.filter((v) => v.inWorkspace) : views,
      rateLimits,
      quotaWindow: rateLimits?.fiveHour ? windowTotals(events, rateLimits.fiveHour.resetsAt, nowMs) : undefined,
      block: currentBlock(events, nowMs),
      bridgeInstalled: await this.bridgeInstalled(),
      takenAt: nowMs,
    };
  }

  private async readLive() {
    const names = (await listDir(this.p.liveSessions)).filter((n) => n.endsWith('.json'));
    const files = await Promise.all(
      names.map(async (name) => ({ name, text: (await readText(join(this.p.liveSessions, name))) ?? '' })),
    );
    return parseLiveSessions(files, this.isAlive);
  }

  /** sessionId -> transcript path, for live sessions plus any transcript touched in the last 5 h. */
  private async findTranscripts(liveIds: Set<string>, nowMs: number): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const slug of await listDir(this.p.projects)) {
      const dir = join(this.p.projects, slug);
      for (const name of await listDir(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length);
        const path = join(dir, name);
        if (!liveIds.has(id)) {
          const s = await stat(path).catch(() => undefined);
          if (!s || nowMs - s.mtimeMs > RECENT_MS) continue;
        }
        found.set(id, path);
      }
    }
    return found;
  }

  private async usageFor(id: string, transcript: string): Promise<SessionUsage | undefined> {
    let usage = await this.parseCached(transcript, id);
    if (!usage) return undefined;
    const subDir = join(transcript.slice(0, -'.jsonl'.length), 'subagents');
    for (const name of await listDir(subDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const sub = await this.parseCached(join(subDir, name), name);
      if (sub) usage = mergeUsage(usage, sub);
    }
    return usage;
  }

  private async parseCached(path: string, id: string): Promise<SessionUsage | undefined> {
    const s = await stat(path).catch(() => undefined);
    if (!s) return undefined;
    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.usage;
    const text = await readText(path);
    if (text === undefined) return undefined;
    this.parseCount++;
    const usage = parseTranscript(text, id);
    this.cache.set(path, { mtimeMs: s.mtimeMs, size: s.size, usage });
    return usage;
  }

  private async readBridges(nowMs: number): Promise<BridgeSnapshot[]> {
    const out: BridgeSnapshot[] = [];
    for (const name of await listDir(this.p.bridgeSnapshots)) {
      if (!name.endsWith('.json')) continue;
      const text = await readText(join(this.p.bridgeSnapshots, name));
      try {
        const snap = JSON.parse(text ?? '');
        if (typeof snap?.session_id !== 'string' || typeof snap.written_at !== 'number') continue;
        if (nowMs - snap.written_at > BRIDGE_MAX_AGE_MS) continue;
        out.push(snap);
      } catch {
        // half-written or foreign file
      }
    }
    return out;
  }

  private async bridgeInstalled(): Promise<boolean> {
    try {
      const s = JSON.parse((await readText(this.p.settings)) ?? '{}');
      return typeof s?.statusLine?.command === 'string' && s.statusLine.command.includes('statusline-bridge');
    } catch {
      return false;
    }
  }
}
