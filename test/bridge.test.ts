import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handle } = require('../bridge/statusline-bridge.js');

const NOW = Date.parse('2026-10-12T02:00:00Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'cu-bridge-'));

const input = {
  session_id: 'abc-123',
  session_name: 'balling',
  cwd: '/w',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: { used_percentage: 31.2, context_window_size: 200000, total_input_tokens: 62400 },
  rate_limits: {
    five_hour: { used_percentage: 41.6, resets_at: 1791800000 },
    seven_day: { used_percentage: 12, resets_at: 1792000000 },
  },
};

describe('statusline bridge', () => {
  it('writes a per-session snapshot', () => {
    const dir = tmp();
    handle(input, dir, NOW);
    const snap = JSON.parse(readFileSync(join(dir, 'sessions', 'abc-123.json'), 'utf8'));
    expect(snap).toEqual({
      session_id: 'abc-123',
      session_name: 'balling',
      cwd: '/w',
      model: 'Opus 5.5',
      context_used_percentage: 31.2,
      context_window_size: 200000,
      context_tokens: 62400,
      rate_limits: input.rate_limits,
      written_at: NOW,
    });
    expect(readdirSync(join(dir, 'sessions'))).toEqual(['abc-123.json']);
  });

  it('prints quota and context usage', () => {
    expect(handle(input, tmp(), NOW)).toBe('5h 42% · ctx 31%');
  });

  it('prints only context when there is no quota', () => {
    expect(handle({ ...input, rate_limits: undefined }, tmp(), NOW)).toBe('ctx 31%');
  });

  it('refuses path-unsafe session ids', () => {
    const dir = tmp();
    handle({ ...input, session_id: '../../evil' }, dir, NOW);
    expect(() => readdirSync(join(dir, 'sessions'))).toThrow();
  });

  it('never throws on empty input', () => {
    expect(handle({}, tmp(), NOW)).toBe('');
    expect(handle(null, tmp(), NOW)).toBe('');
  });
});
