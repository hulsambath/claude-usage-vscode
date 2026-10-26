import { basename } from 'node:path';
import { estimateRemaining, projectPace } from './estimate';
import { formatClock, formatDuration, formatTokens } from './format';
import { generateHandoffPrompt } from './handoff';
import { AgentMeshMessage, OrchestratorMode, Pipeline, PipelineRecipe } from './orchestrator/types';
import { AgentType, SessionView, UsageSnapshot, totalTokens } from './types';

export type Level = 'ok' | 'warn' | 'crit';

export interface AgentCardVM {
  agent: AgentType;
  name: string;
  headline: string;
  tokensLine?: string;
  resetLine?: string;
  paceLine?: string;
  level: Level;
  gauge?: {
    usedPct?: number;
    elapsedPct?: number;
    legendUsed?: string;
    legendTime?: string;
    ariaLabel?: string;
  };
  contextTrack?: {
    usedPct: number;
    line: string;
  };
  weekly?: {
    usedPct: number;
    line: string;
    level: Level;
  };
  note?: {
    text: string;
    action?: 'install';
  };
  handoff?: {
    sessionId: string;
    targetAgent: AgentType;
    label: string;
  };
}

export interface ContextBridgeItemVM {
  sourceSessionId: string;
  sourceTitle: string;
  sourceAgent: AgentType;
  targetAgent: AgentType;
}

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
  contextBridge?: ContextBridgeItemVM;
  contextBridges?: {
    toAntigravity?: ContextBridgeItemVM;
    toClaude?: ContextBridgeItemVM;
  };
  agentFilter?: AgentType | 'all';
  counts?: { all: number; claude: number; antigravity: number };
  claudeCard?: AgentCardVM;
  antigravityCard?: AgentCardVM;
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

export interface OrchestratorVM {
  mode: OrchestratorMode;
  activePipeline?: Pipeline;
  recipes: Array<{ id: string; title: string; description: string; stepCount: number }>;
  meshMessages: AgentMeshMessage[];
  mcpServerInstalled?: boolean;
}

export interface ViewModel {
  quota: QuotaVM;
  sessions: SessionVM[];
  orchestrator?: OrchestratorVM;
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

  const note = snap.bridgeInstalled
    ? { text: 'The official percentage shows after your next Claude response.' }
    : { text: 'Install the status line bridge to see your official quota.', action: 'install' as const };

  const agyTok = snap.antigravityTotals ? totalTokens(snap.antigravityTotals) : 0;
  const claudeTok = snap.block ? totalTokens(snap.block.totals) : 0;

  // 1. Build Claude Card
  let claudeCard: AgentCardVM;
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

    claudeCard = {
      agent: 'claude',
      name: 'Claude Code',
      headline: `${Math.max(0, Math.round(100 - used))}% left`,
      level: pace.kind === 'limit' && level(used, warnAt) === 'ok' ? 'warn' : level(used, warnAt),
      gauge: {
        usedPct: Math.min(100, Math.round(used)),
        elapsedPct: pace.elapsedPct,
        legendUsed: `Quota used ${Math.min(100, Math.round(used))}%`,
        legendTime: `Time passed ${Math.min(100, Math.round(pace.elapsedPct))}%`,
        ariaLabel: `${Math.round(used)}% of the 5-hour quota used, ${Math.round(pace.elapsedPct)}% of the window elapsed`,
      },
      resetLine: `Resets ${resetPhrase(end, now)}`,
      tokensLine: est ? `About ${formatTokens(est.remaining)} tokens left of roughly ${formatTokens(est.limit)}` : undefined,
      paceLine,
      weekly,
    };
  } else if (snap.block) {
    const elapsed = Math.round(((now - snap.block.start) / (snap.block.end - snap.block.start)) * 100);
    claudeCard = {
      agent: 'claude',
      name: 'Claude Code',
      headline: `${formatTokens(claudeTok)} tokens used`,
      level: 'ok',
      gauge: {
        elapsedPct: elapsed,
        legendTime: `Window elapsed ${elapsed}%`,
        ariaLabel: `${elapsed}% of the window elapsed`,
      },
      resetLine: `This 5-hour window ends ${resetPhrase(snap.block.end, now)}`,
      weekly,
      note,
    };
  } else {
    claudeCard = {
      agent: 'claude',
      name: 'Claude Code',
      headline: weekly ? `${weekly.usedPct}% week used` : 'Idle in last 5 hours',
      level: 'ok',
      weekly,
      note,
    };
  }

  // 2. Build Antigravity Card
  const activeCount = agySessions.filter((s) => s.live?.status === 'busy').length;
  const activeSession = agySessions.find((s) => s.live?.status === 'busy') || agySessions[0];
  const b = activeSession?.bridge;
  let contextTrack: AgentCardVM['contextTrack'] | undefined;
  if (b && typeof b.context_used_percentage === 'number') {
    const size = b.context_window_size;
    const usedTokens = b.context_tokens ?? (size ? Math.round((size * b.context_used_percentage) / 100) : undefined);
    contextTrack = {
      usedPct: Math.round(b.context_used_percentage),
      line:
        size && usedTokens !== undefined
          ? `${formatTokens(Math.max(0, size - usedTokens))} of ${formatTokens(size)} context tokens left`
          : `${Math.round(100 - b.context_used_percentage)}% context left`,
    };
  }

  let agyElapsedPct = 0;
  let agyResetLine: string | undefined;
  if (snap.antigravityBlock) {
    agyElapsedPct = Math.min(100, Math.max(0, Math.round(((now - snap.antigravityBlock.start) / (snap.antigravityBlock.end - snap.antigravityBlock.start)) * 100)));
    agyResetLine = `5-hour window ends ${resetPhrase(snap.antigravityBlock.end, now)}`;
  }

  const antigravityCard: AgentCardVM = {
    agent: 'antigravity',
    name: 'Antigravity',
    headline: agyTok > 0 ? `${formatTokens(agyTok)} tokens used` : 'Idle in last 5 hours',
    level: 'ok',
    gauge: {
      usedPct: contextTrack ? contextTrack.usedPct : undefined,
      elapsedPct: agyElapsedPct > 0 ? agyElapsedPct : undefined,
      legendUsed: contextTrack ? `Context used ${contextTrack.usedPct}%` : undefined,
      legendTime: agyElapsedPct > 0 ? `Window elapsed ${agyElapsedPct}%` : undefined,
      ariaLabel: `Antigravity 5-hour window: ${agyElapsedPct}% elapsed${contextTrack ? `, ${contextTrack.usedPct}% context used` : ''}`,
    },
    contextTrack,
    resetLine: agyResetLine,
    tokensLine: `${agySessions.length} conversation${agySessions.length === 1 ? '' : 's'}${activeCount > 0 ? `, ${activeCount} active` : ''}`,
  };

  const antigravityUsage = agyTok > 0 ? {
    tokens: formatTokens(agyTok),
    count: agySessions.length,
    activeCount,
    resetLine: agyResetLine,
  } : undefined;

  const latestClaude = claudeSessions[0];
  const latestAgy = agySessions[0];

  if (latestClaude) {
    claudeCard.handoff = {
      sessionId: latestClaude.sessionId,
      targetAgent: 'antigravity',
      label: 'Handoff to Antigravity',
    };
  }

  if (latestAgy) {
    antigravityCard.handoff = {
      sessionId: latestAgy.sessionId,
      targetAgent: 'claude',
      label: 'Handoff to Claude',
    };
  }

  const toAntigravity: ContextBridgeItemVM | undefined = latestClaude
    ? {
        sourceSessionId: latestClaude.sessionId,
        sourceTitle: latestClaude.title || latestClaude.live?.name || latestClaude.sessionId.slice(0, 8),
        sourceAgent: 'claude',
        targetAgent: 'antigravity',
      }
    : undefined;

  const toClaude: ContextBridgeItemVM | undefined = latestAgy
    ? {
        sourceSessionId: latestAgy.sessionId,
        sourceTitle: latestAgy.title || latestAgy.live?.name || latestAgy.sessionId.slice(0, 8),
        sourceAgent: 'antigravity',
        targetAgent: 'claude',
      }
    : undefined;

  const contextBridges = (toAntigravity || toClaude) ? {
    toAntigravity,
    toClaude,
  } : undefined;

  let contextBridge = toClaude || toAntigravity;
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

  // 3. Overall Headline & State
  let headline = 'No usage in the last 5 hours';
  let state: QuotaVM['state'] = 'none';
  let levelVal: Level = 'ok';
  let usedPct: number | undefined;
  let elapsedPct: number | undefined;
  let resetLine: string | undefined;
  let tokensLine: string | undefined;
  let tokensLeft: string | undefined;
  let paceLine: string | undefined;

  if (filter === 'antigravity') {
    headline = antigravityCard.headline;
    state = agyTok > 0 ? 'local' : 'none';
    resetLine = antigravityCard.resetLine;
    tokensLine = antigravityCard.tokensLine;
    usedPct = antigravityCard.gauge?.usedPct;
    elapsedPct = antigravityCard.gauge?.elapsedPct;
  } else if (filter === 'claude') {
    headline = claudeCard.headline;
    state = five ? 'official' : snap.block ? 'local' : 'none';
    levelVal = claudeCard.level;
    usedPct = claudeCard.gauge?.usedPct;
    elapsedPct = claudeCard.gauge?.elapsedPct;
    resetLine = claudeCard.resetLine;
    tokensLine = claudeCard.tokensLine;
    paceLine = claudeCard.paceLine;
  } else {
    if (five) {
      state = 'official';
      headline = `${Math.max(0, Math.round(100 - five.usedPercentage))}% left`;
      usedPct = Math.min(100, Math.round(five.usedPercentage));
      levelVal = claudeCard.level;
      elapsedPct = claudeCard.gauge?.elapsedPct;
      resetLine = claudeCard.resetLine;
      const est = snap.quotaWindow && estimateRemaining(totalTokens(snap.quotaWindow.totals), five.usedPercentage);
      tokensLeft = est && formatTokens(est.remaining);
      tokensLine = claudeCard.tokensLine;
      paceLine = claudeCard.paceLine;
    } else if (claudeTok > 0 && agyTok > 0) {
      state = 'local';
      headline = `${formatTokens(claudeTok + agyTok)} tokens used`;
      elapsedPct = snap.block ? Math.round(((now - snap.block.start) / (snap.block.end - snap.block.start)) * 100) : agyElapsedPct;
      resetLine = `5-hour window ends ${resetPhrase(snap.block?.end || snap.antigravityBlock!.end, now)}`;
    } else if (claudeTok > 0) {
      state = 'local';
      headline = `${formatTokens(claudeTok)} tokens used`;
      elapsedPct = Math.round(((now - snap.block!.start) / (snap.block!.end - snap.block!.start)) * 100);
      resetLine = `This 5-hour window ends ${resetPhrase(snap.block!.end, now)}`;
    } else if (agyTok > 0) {
      state = 'local';
      headline = `${formatTokens(agyTok)} tokens used`;
      elapsedPct = agyElapsedPct;
      resetLine = agyResetLine;
      tokensLine = antigravityCard.tokensLine;
    }
  }

  return {
    state,
    headline,
    usedPct,
    elapsedPct,
    level: levelVal,
    resetLine,
    tokensLine,
    tokensLeft,
    paceLine,
    weekly,
    note,
    antigravityUsage,
    contextBridge,
    contextBridges,
    agentFilter: filter,
    counts,
    claudeCard,
    antigravityCard,
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

export function buildViewModel(
  snap: UsageSnapshot,
  warnAt: number,
  filter: AgentType | 'all' = 'all',
  orchestratorOptions?: {
    mode?: OrchestratorMode;
    activePipeline?: Pipeline;
    recipes?: PipelineRecipe[];
    meshMessages?: AgentMeshMessage[];
    mcpInstalled?: boolean;
  },
): ViewModel {
  const filteredSessions =
    filter === 'claude'
      ? snap.sessions.filter((s) => s.agent !== 'antigravity')
      : filter === 'antigravity'
        ? snap.sessions.filter((s) => s.agent === 'antigravity')
        : snap.sessions;

  const orchestrator: OrchestratorVM | undefined = orchestratorOptions
    ? {
        mode: orchestratorOptions.mode || 'monitor',
        activePipeline: orchestratorOptions.activePipeline,
        recipes: (orchestratorOptions.recipes || []).map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          stepCount: r.steps.length,
        })),
        meshMessages: orchestratorOptions.meshMessages || [],
        mcpServerInstalled: orchestratorOptions.mcpInstalled,
      }
    : undefined;

  return {
    quota: buildQuota(snap, warnAt, filter),
    sessions: filteredSessions.map((s) => buildSession(s, snap.takenAt)),
    orchestrator,
  };
}
