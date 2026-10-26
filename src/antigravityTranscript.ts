import { SessionUsage, TokenTotals, UsageEvent, addTotals, emptyTotals } from './types';

export interface AntigravityTranscriptData {
  usage: SessionUsage;
  filesTouched: string[];
  commandsRun: string[];
  firstUserPrompt?: string;
  lastUserPrompt?: string;
  lastThinking?: string;
  contextTokens?: number;
  model: string;
}

export function cleanAntigravityPrompt(raw: string): string {
  const reqMatch = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  let prompt = reqMatch ? reqMatch[1] : raw;
  prompt = prompt.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');
  prompt = prompt.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '');
  return prompt.trim();
}

export function parseAntigravityTranscript(text: string, sessionId: string, defaultModel = 'Gemini 3.8 Flash'): AntigravityTranscriptData {
  let model = defaultModel;
  let firstUserPrompt: string | undefined;
  let lastUserPrompt: string | undefined;
  let lastThinking: string | undefined;
  let contextTokens: number | undefined;
  const filesTouched = new Set<string>();
  const commandsRun = new Set<string>();
  const events: UsageEvent[] = [];

  for (const line of text.split('\n')) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object') continue;

    if (d.type === 'USER_INPUT' && typeof d.content === 'string') {
      const prompt = cleanAntigravityPrompt(d.content);
      if (!firstUserPrompt && prompt) firstUserPrompt = prompt;
      if (prompt) lastUserPrompt = prompt;

      const mMatch = d.content.match(/Model Selection` from .*? to ([^\n<]+)/);
      if (mMatch && mMatch[1]) {
        const candidate = mMatch[1].replace(/\.$/, '').trim();
        if (candidate && candidate !== 'None') {
          model = candidate;
        }
      }
    }

    if (d.thinking && typeof d.thinking === 'string') {
      const trimmed = d.thinking.trim();
      if (trimmed) lastThinking = trimmed.slice(0, 500);
    }

    if (Array.isArray(d.tool_calls)) {
      for (const call of d.tool_calls) {
        if (!call) continue;
        const name = call.name;
        const args = call.args || {};
        if (name === 'write_file' || name === 'edit_file') {
          const p = typeof args.Path === 'string' ? args.Path.replace(/^"|"$/g, '').trim() : undefined;
          if (p) filesTouched.add(p);
        }
        if (name === 'run_command' && typeof args.CommandLine === 'string') {
          const cmd = args.CommandLine.replace(/^"|"$/g, '').trim();
          if (cmd) commandsRun.add(cmd);
        }
      }
    }

    if (d.input_tokens !== undefined || d.output_tokens !== undefined || d.cache_read_tokens !== undefined) {
      const input = Number(d.input_tokens) || 0;
      const output = Number(d.output_tokens) || 0;
      const cacheRead = Number(d.cache_read_tokens) || 0;
      const cacheWrite = Number(d.cache_write_tokens) || 0;
      const at = d.created_at ? Date.parse(d.created_at) : Date.now();

      contextTokens = input + cacheRead;

      events.push({
        at: Number.isNaN(at) ? Date.now() : at,
        model,
        tokens: {
          input,
          output,
          cacheRead,
          cacheWrite,
          messages: 1,
        },
      });
    }
  }

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

  return {
    usage: {
      sessionId,
      firstAt,
      lastAt,
      totals,
      byModel,
      events,
    },
    filesTouched: [...filesTouched],
    commandsRun: [...commandsRun],
    firstUserPrompt,
    lastUserPrompt,
    lastThinking,
    contextTokens,
    model,
  };
}
