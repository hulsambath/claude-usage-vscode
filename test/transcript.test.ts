import { describe, expect, it } from 'vitest';
import { mergeUsage, parseTranscript } from '../src/transcript';

const assistant = (id: string, req: string, at: string, usage: object, model = 'claude-opus-5-5') =>
  JSON.stringify({ type: 'assistant', requestId: req, timestamp: at, cwd: '/w', message: { id, model, usage } });

const u = (input: number, output: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});

describe('parseTranscript', () => {
  it('sums token fields across assistant messages', () => {
    const text = [
      assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(10, 20, 30, 40)),
      assistant('m2', 'r2', '2026-10-12T01:05:00Z', u(1, 2, 3, 4)),
    ].join('\n');
    const s = parseTranscript(text, 's1');
    expect(s.totals).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, messages: 2 });
    expect(s.firstAt).toBe(Date.parse('2026-10-12T01:00:00Z'));
    expect(s.lastAt).toBe(Date.parse('2026-10-12T01:05:00Z'));
    expect(s.cwd).toBe('/w');
    expect(s.events).toHaveLength(2);
  });

  it('dedupes repeated message ids, keeping the last usage', () => {
    const text = [
      assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(5, 1)),
      assistant('m1', 'r1', '2026-10-12T01:00:01Z', u(5, 7)),
      assistant('m1', 'r1', '2026-10-12T01:00:02Z', u(5, 9)),
    ].join('\n');
    const s = parseTranscript(text, 's1');
    expect(s.totals.messages).toBe(1);
    expect(s.totals.output).toBe(9);
    expect(s.totals.input).toBe(5);
  });

  it('skips malformed and half-written lines', () => {
    const good = assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(1, 1));
    const text = ['not json', good, good.slice(0, 40)].join('\n');
    expect(parseTranscript(text, 's1').totals.messages).toBe(1);
  });

  it('ignores synthetic messages and lines without usage', () => {
    const text = [
      assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(1, 1), '<synthetic>'),
      JSON.stringify({ type: 'assistant', message: { id: 'm2', model: 'x' } }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    ].join('\n');
    expect(parseTranscript(text, 's1').totals.messages).toBe(0);
  });

  it('splits by model and reads the latest ai title', () => {
    const text = [
      JSON.stringify({ type: 'ai-title', aiTitle: 'First' }),
      assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(1, 1), 'claude-opus-5-5'),
      assistant('m2', 'r2', '2026-10-12T01:00:00Z', u(2, 2), 'claude-haiku-5-5'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Second' }),
    ].join('\n');
    const s = parseTranscript(text, 's1');
    expect(Object.keys(s.byModel).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(s.byModel['claude-haiku-5-5'].input).toBe(2);
    expect(s.title).toBe('Second');
  });
});

describe('mergeUsage', () => {
  it('adds subagent usage into the parent session', () => {
    const a = parseTranscript(assistant('m1', 'r1', '2026-10-12T01:00:00Z', u(1, 1)), 's1');
    const b = parseTranscript(assistant('m9', 'r9', '2026-10-12T02:00:00Z', u(2, 2), 'claude-haiku-5-5'), 'agent');
    const m = mergeUsage(a, b);
    expect(m.sessionId).toBe('s1');
    expect(m.totals.input).toBe(3);
    expect(m.events).toHaveLength(2);
    expect(m.byModel['claude-haiku-5-5'].output).toBe(2);
    expect(m.lastAt).toBe(Date.parse('2026-10-12T02:00:00Z'));
  });
});
