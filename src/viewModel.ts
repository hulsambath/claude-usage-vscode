import { basename } from 'node:path';
import { estimateRemaining, projectPace } from './estimate';
import { formatClock, formatDuration, formatTokens } from './format';
import { generateHandoffPrompt } from './handoff';
import { AgentType, SessionView, UsageSnapshot, totalTokens } from './types';

export type Level = 'ok' | 'warn' | 'crit';

export interface QuotaVM {
  state: 'official' | 'local' | 'none';
  headline: string;
  usedPct?: number;
  elapsedPct?: number;
  level: Level;
  resetLine?: string;
  tokensLine?: string;
  /** Short estimate for the status bar, e.g. "2.1M". */
  tokensLeft?: string;
  paceLine?: string;
  weekly?: { usedPct: number; line: string; level: Level };
  note?: { text: string; action?: 'install' };
  antigravityUsage?: { tokens: string; count: number; activeCount: number; resetLine?: string };
  claudeUsage?: { tokens: string; count: number; activeCount: number };
  contextBridge?: { sourceSessionId: string; sourceTitle: string; sourceAgent: AgentType; targetAgent: AgentType };
  agentFilter?: AgentType | 'all';
  counts?: { all: number; claude: number; antigravity: number };
}

export interface SessionVM {
  id: string;
  agent: AgentType;
  name: string;
  title?: string;
  state: 'busy' | 'idle' | 'closed';
  tokens: string;
  meta: string;
  inWorkspace: boolean;
  canOpen: boolean;
  context?: { usedPct: number; line: string };
  details: [string, string][];
  filesTouched?: string[];
  commandsRun?: string[];
  userPrompt?: string;
  lastThinking?: string;
  handoffPrompt?: string;
}

export interface ViewModel {
  quota: QuotaVM;
  sessions: SessionVM[];
}

const level = (pct: number, warnAt: number): Level => (pct >= 95 ? 'crit' : pct >= warnAt ? 'warn' : 'ok');

export function formatAgo(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

function tildify(path: string): string {
  const home = process.env.HOME;
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

const resetPhrase = (atMs: number, now: number) => `at ${formatClock(atMs)}, in ${formatDuration(atMs - now)}`;

function buildQuota(snap: UsageSnapshot, warnAt: number, filter: AgentType | 'all' = 'all'): QuotaVM {
  const now = snap.takenAt;
  const five = snap.rateLimits?.fiveHour;
  const seven = snap.rateLimits?.sevenDay;
  const weekly = seven && {
    usedPct: Math.round(seven.usedPercentage),
    line: `${Math.round(seven.usedPercentage)}% of this week used, resets in ${formatDuration(seven.resetsAt * 1000 - now)}`,
    level: level(seven.usedPercentage, warnAt),
  };

  const claudeSessions = snap.sessions.filter((s) => s.agent !== 'antigravity');
  const agySessions = snap.sessions.filter((s) => s.agent === 'antigravity');
  const counts = {
    all: snap.sessions.length,
    claude: claudeSessions.length,
    antigravity: agySessions.length,
  };

  let antigravityUsage: QuotaVM['antigravityUsage'] | undefined;
  if (snap.antigravityTotals) {
    const agyTok = totalTokens(snap.antigravityTotals);
    const active = agySessions.filter((s) => s.live?.status === 'busy').length;
    antigravityUsage = {
      tokens: formatTokens(agyTok),
      count: agySessions.length,
      activeCount: active,
      resetLine: snap.antigravityBlock ? `5-hour window ends ${resetPhrase(snap.antigravityBlock.end, now)}` : undefined,
    };
  }

  let contextBridge: QuotaVM['contextBridge'] | undefined;
  if (snap.sessions.length > 0) {
    const mostRecent = snap.sessions[0];
    const sourceAgent: AgentType = mostRecent.agent || 'claude';
    const targetAgent: AgentType = sourceAgent === 'claude' ? 'antigravity' : 'claude';
    contextBridge = {
      sourceSessionId: mostRecent.sessionId,
      sourceTitle: mostRecent.title || mostRecent.live?.name || mostRecent.sessionId.slice(0, 8),
      sourceAgent,
      targetAgent,
    };
  }

  if (five) {
    const end = five.resetsAt * 1000;
    const start = end - 5 * 3_600_000;
    const used = five.usedPercentage;
    const pace = projectPace(used, start, end, now);
    const est = snap.quotaWindow && estimateRemaining(totalTokens(snap.quotaWindow.totals), used);
    let paceLine: string | undefined;
    if (pace.kind === 'reached') paceLine = `Limit reached. It resets ${resetPhrase(end, now)}.`;
    if (pace.kind === 'limit') {
      paceLine = `At this pace you'll hit the limit around ${formatClock(pace.at)}, ${formatDuration(end - pace.at)} before it resets.`;
    }
    if (pace.kind === 'spare') paceLine = `At this pace you'll finish this window with about ${pace.leftPct}% to spare.`;
    return {
      state: 'official',
      headline: `${Math.max(0, Math.round(100 - used))}% left`,
      usedPct: Math.min(100, Math.round(used)),
      elapsedPct: pace.elapsedPct,
      level: pace.kind === 'limit' && level(used, warnAt) === 'ok' ? 'warn' : level(used, warnAt),
      resetLine: `Resets ${resetPhrase(end, now)}`,
      tokensLeft: est && formatTokens(est.remaining),
      tokensLine: est && `About ${formatTokens(est.remaining)} tokens left of roughly ${formatTokens(est.limit)}`,
      paceLine,
      weekly,
      antigravityUsage,
      contextBridge,
      agentFilter: filter,
      counts,
    };
  }

  const note = snap.bridgeInstalled
    ? { text: 'The official percentage shows after your next Claude response.' }
    : { text: 'Install the status line bridge to see your official quota.', action: 'install' as const };

  if (snap.block) {
    return {
      state: 'local',
      headline: `${formatTokens(totalTokens(snap.block.totals))} tokens used`,
      elapsedPct: Math.round(((now - snap.block.start) / (snap.block.end - snap.block.start)) * 100),
      level: 'ok',
      resetLine: `This 5-hour window ends ${resetPhrase(snap.block.end, now)}`,
      weekly,
      note,
      antigravityUsage,
      contextBridge,
      agentFilter: filter,
      counts,
    };
  }
  return {
    state: 'none',
    headline: 'No usage in the last 5 hours',
    level: 'ok',
    weekly,
    note,
    antigravityUsage,
    contextBridge,
    agentFilter: filter,
    counts,
  };
}

function buildSession(v: SessionView, now: number): SessionVM {
  const u = v.usage;
  const agent: AgentType = v.agent || 'claude';
  const state = !v.live ? 'closed' : v.live.status === 'busy' ? 'busy' : 'idle';
  const folder = basename(v.live?.cwd || u?.cwd || '') || 'unknown folder';
  const lastAt = Math.max(v.live?.updatedAt ?? 0, u?.lastAt ?? 0);
  const meta =
    state === 'busy'
      ? `Working now in ${folder}`
      : state === 'idle'
        ? now - lastAt < 60_000
          ? `Idle, replied just now in ${folder}`
          : `Idle for ${formatAgo(now - lastAt).replace(' ago', '')} in ${folder}`
        : `Closed, last reply ${formatAgo(now - lastAt)} in ${folder}`;

  const b = v.bridge;
  let context: SessionVM['context'];
  if (b && typeof b.context_used_percentage === 'number') {
    const size = b.context_window_size;
    const usedTokens = b.context_tokens ?? (size ? Math.round((size * b.context_used_percentage) / 100) : undefined);
    context = {
      usedPct: Math.round(b.context_used_percentage),
      line:
        size && usedTokens !== undefined
          ? `${formatTokens(Math.max(0, size - usedTokens))} of ${formatTokens(size)} context tokens left`
          : `${Math.round(100 - b.context_used_percentage)}% of the context window left`,
    };
  }

  const details: [string, string][] = [];
  if (u) {
    details.push(
      ['Input', formatTokens(u.totals.input)],
      ['Output', formatTokens(u.totals.output)],
      ['Cache read', formatTokens(u.totals.cacheRead)],
      ['Cache write', formatTokens(u.totals.cacheWrite)],
      ['Replies', String(u.totals.messages)],
    );
    for (const [model, t] of Object.entries(u.byModel)) {
      details.push([model, `${formatTokens(totalTokens(t))} tokens, ${t.messages} messages`]);
    }
  }
  if (v.filesTouched && v.filesTouched.length > 0) {
    const names = v.filesTouched.slice(0, 4).map((f) => basename(f)).join(', ');
    const more = v.filesTouched.length > 4 ? ` (+${v.filesTouched.length - 4} more)` : '';
    details.push(['Files touched', `${names}${more}`]);
  }
  if (b?.model) details.push(['Model now', b.model]);
  details.push(['Folder', tildify(v.live?.cwd || u?.cwd || 'unknown')]);

  return {
    id: v.sessionId,
    agent,
    name: v.live?.name || b?.session_name || u?.title || v.sessionId.slice(0, 8),
    title: u?.title,
    state,
    tokens: formatTokens(u ? totalTokens(u.totals) : 0),
    meta,
    inWorkspace: v.inWorkspace,
    canOpen: !!v.transcriptPath,
    context,
    details,
    filesTouched: v.filesTouched,
    commandsRun: v.commandsRun,
    userPrompt: v.userPrompt,
    lastThinking: v.lastThinking,
    handoffPrompt: generateHandoffPrompt({ sourceSession: v }),
  };
}

export function buildViewModel(snap: UsageSnapshot, warnAt: number, filter: AgentType | 'all' = 'all'): ViewModel {
  const filteredSessions =
    filter === 'claude'
      ? snap.sessions.filter((s) => s.agent !== 'antigravity')
      : filter === 'antigravity'
        ? snap.sessions.filter((s) => s.agent === 'antigravity')
        : snap.sessions;

  return { quota: buildQuota(snap, warnAt, filter), sessions: filteredSessions.map((s) => buildSession(s, snap.takenAt)) };
}
