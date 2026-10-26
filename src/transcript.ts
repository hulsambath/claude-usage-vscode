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

export interface ClaudeTranscriptDetails {
  usage: SessionUsage;
  filesTouched: string[];
  commandsRun: string[];
  userPrompt?: string;
  lastThinking?: string;
}

/**
 * Turns a Claude Code transcript (JSONL) into token usage and details.
 */
export function parseClaudeTranscriptDetails(text: string, sessionId: string): ClaudeTranscriptDetails {
  const byKey = new Map<string, UsageEvent>();
  let title: string | undefined;
  let cwd: string | undefined;
  let userPrompt: string | undefined;
  let lastThinking: string | undefined;
  const filesTouched = new Set<string>();
  const commandsRun = new Set<string>();

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

    if (d.type === 'user' && d.message?.content) {
      const c = d.message.content;
      const textContent = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: any) => b.text || '').join('') : '';
      if (!userPrompt && textContent.trim()) userPrompt = textContent.trim();
    }

    if (d.type !== 'assistant') continue;
    const m = d.message;
    if (Array.isArray(m?.content)) {
      for (const block of m.content) {
        if (block?.type === 'thinking' && typeof block.thinking === 'string') {
          const t = block.thinking.trim();
          if (t) lastThinking = t.slice(0, 500);
        }
        if (block?.type === 'tool_use') {
          const name = block.name;
          const input = block.input || {};
          if (['Edit', 'Write', 'FileEdit', 'MultiFileEdit'].includes(name)) {
            const p = input.file_path || input.path;
            if (typeof p === 'string') filesTouched.add(p);
          }
          if (name === 'Bash' && typeof input.command === 'string') {
            commandsRun.add(input.command);
          }
        }
      }
    }

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

  return {
    usage: build(sessionId, [...byKey.values()], title, cwd),
    filesTouched: [...filesTouched],
    commandsRun: [...commandsRun],
    userPrompt,
    lastThinking,
  };
}

/**
 * Turns a Claude Code transcript (JSONL) into token usage. Streaming writes
 * one assistant message as several lines sharing message.id + requestId; the
 * last one carries the final usage, so later lines replace earlier ones.
 */
export function parseTranscript(text: string, sessionId: string): SessionUsage {
  return parseClaudeTranscriptDetails(text, sessionId).usage;
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
