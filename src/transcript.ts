import { SessionUsage, TokenTotals, UsageEvent, addTotals, emptyTotals } from './types';

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const toTotals = (u: RawUsage): TokenTotals => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  messages: 1,
});

/**
 * Turns a Claude Code transcript (JSONL) into token usage. Streaming writes
 * one assistant message as several lines sharing message.id + requestId; the
 * last one carries the final usage, so later lines replace earlier ones.
 */
export function parseTranscript(text: string, sessionId: string): SessionUsage {
  const byKey = new Map<string, UsageEvent>();
  let title: string | undefined;
  let cwd: string | undefined;

  for (const line of text.split('\n')) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    if (cwd === undefined && typeof d.cwd === 'string') cwd = d.cwd;
    if (d.type === 'ai-title' && typeof d.aiTitle === 'string') title = d.aiTitle;
    if (d.type !== 'assistant') continue;
    const m = d.message;
    if (!m?.usage || m.model === '<synthetic>') continue;
    const at = Date.parse(d.timestamp);
    const key = `${m.id ?? d.uuid}:${d.requestId ?? ''}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      at: prev?.at ?? (Number.isNaN(at) ? 0 : at),
      model: m.model ?? 'unknown',
      tokens: toTotals(m.usage),
    });
  }

  return build(sessionId, [...byKey.values()], title, cwd);
}

function build(sessionId: string, events: UsageEvent[], title?: string, cwd?: string): SessionUsage {
  let totals = emptyTotals();
  const byModel: Record<string, TokenTotals> = {};
  let firstAt: number | undefined;
  let lastAt: number | undefined;
  for (const e of events) {
    totals = addTotals(totals, e.tokens);
    byModel[e.model] = addTotals(byModel[e.model] ?? emptyTotals(), e.tokens);
    if (e.at > 0) {
      firstAt = firstAt === undefined ? e.at : Math.min(firstAt, e.at);
      lastAt = lastAt === undefined ? e.at : Math.max(lastAt, e.at);
    }
  }
  return { sessionId, title, cwd, firstAt, lastAt, totals, byModel, events };
}

/** Folds a subagent transcript's usage into its parent session. */
export function mergeUsage(parent: SessionUsage, child: SessionUsage): SessionUsage {
  return build(parent.sessionId, [...parent.events, ...child.events], parent.title, parent.cwd);
}
