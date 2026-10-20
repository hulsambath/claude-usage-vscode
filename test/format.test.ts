import { describe, expect, it } from 'vitest';
import { formatDuration, formatPercent, formatTokens } from '../src/format';

describe('formatTokens', () => {
  it('keeps small numbers exact', () => expect(formatTokens(999)).toBe('999'));
  it('abbreviates thousands', () => expect(formatTokens(12_345)).toBe('12.3k'));
  it('abbreviates millions', () => expect(formatTokens(4_200_000)).toBe('4.2M'));
});

describe('formatDuration', () => {
  it('formats zero', () => expect(formatDuration(0)).toBe('0m'));
  it('formats hours and padded minutes', () => expect(formatDuration(65 * 60_000)).toBe('1h 05m'));
  it('clamps negatives to zero', () => expect(formatDuration(-5_000)).toBe('0m'));
  it('formats days for the weekly window', () => expect(formatDuration((2 * 24 + 3) * 3_600_000)).toBe('2d 3h'));
});

describe('formatPercent', () => {
  it('rounds', () => expect(formatPercent(41.6)).toBe('42%'));
});
