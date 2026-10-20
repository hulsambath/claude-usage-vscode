import { describe, expect, it } from 'vitest';
import { currentBlock } from '../src/blocks';
import { UsageEvent } from '../src/types';

const H = 3_600_000;
const T0 = Date.parse('2026-10-12T00:00:00Z');
const ev = (at: number, output = 10): UsageEvent => ({
  at,
  model: 'm',
  tokens: { input: 1, output, cacheRead: 0, cacheWrite: 0, messages: 1 },
});

describe('currentBlock', () => {
  it('starts the block at the first event floored to the hour', () => {
    const b = currentBlock([ev(T0 + 25 * 60_000), ev(T0 + H)], T0 + 2 * H);
    expect(b?.start).toBe(T0);
    expect(b?.end).toBe(T0 + 5 * H);
    expect(b?.totals.messages).toBe(2);
  });

  it('starts a new block once the previous one has run five hours', () => {
    const b = currentBlock([ev(T0 + 10 * 60_000, 1), ev(T0 + 5 * H + 30 * 60_000, 7)], T0 + 6 * H);
    expect(b?.start).toBe(T0 + 5 * H);
    expect(b?.totals.output).toBe(7);
  });

  it('starts a new block after a long gap', () => {
    const b = currentBlock([ev(T0), ev(T0 + 9 * H + 15 * 60_000)], T0 + 10 * H);
    expect(b?.start).toBe(T0 + 9 * H);
    expect(b?.totals.messages).toBe(1);
  });

  it('returns undefined when the last block has ended', () => {
    expect(currentBlock([ev(T0)], T0 + 5 * H)).toBeUndefined();
    expect(currentBlock([], T0)).toBeUndefined();
  });

  it('accepts unsorted events', () => {
    const b = currentBlock([ev(T0 + H), ev(T0)], T0 + 2 * H);
    expect(b?.totals.messages).toBe(2);
  });
});
