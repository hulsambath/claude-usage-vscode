export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
}

/** One deduplicated assistant message. */
export interface UsageEvent {
  at: number;
  model: string;
  tokens: TokenTotals;
}

export interface SessionUsage {
  sessionId: string;
  title?: string;
  cwd?: string;
  firstAt?: number;
  lastAt?: number;
  totals: TokenTotals;
  byModel: Record<string, TokenTotals>;
  events: UsageEvent[];
}

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string;
  status: string;
  updatedAt: number;
}

export interface RateWindow {
  usedPercentage: number;
  /** Unix epoch seconds. */
  resetsAt: number;
}

export interface RateLimits {
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
  observedAt: number;
  sessionId: string;
}

interface BridgeWindow {
  used_percentage: number;
  resets_at: number;
}

/** What bridge/statusline-bridge.js writes per session. */
export interface BridgeSnapshot {
  session_id: string;
  session_name?: string;
  cwd?: string;
  model?: string;
  context_used_percentage?: number | null;
  context_window_size?: number;
  /** Input tokens currently in the context window. */
  context_tokens?: number;
  rate_limits?: { five_hour?: BridgeWindow; seven_day?: BridgeWindow };
  /** Epoch milliseconds. */
  written_at: number;
}

export interface BlockUsage {
  start: number;
  end: number;
  totals: TokenTotals;
}

export interface SessionView {
  sessionId: string;
  live?: LiveSession;
  usage?: SessionUsage;
  bridge?: BridgeSnapshot;
  transcriptPath?: string;
  inWorkspace: boolean;
}

export interface UsageSnapshot {
  sessions: SessionView[];
  rateLimits?: RateLimits;
  block?: BlockUsage;
  /** Local tokens inside the official 5h window, when the quota is known. */
  quotaWindow?: BlockUsage;
  bridgeInstalled: boolean;
  takenAt: number;
}

export const emptyTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 });

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    messages: a.messages + b.messages,
  };
}

export const totalTokens = (t: TokenTotals): number => t.input + t.output + t.cacheRead + t.cacheWrite;
