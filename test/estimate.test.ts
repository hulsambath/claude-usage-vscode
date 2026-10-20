import { describe, expect, it } from 'vitest';
import { estimateRemaining, projectPace, windowTotals } from '../src/estimate';
import { UsageEvent } from '../src/types';

const H = 3_600_000;
const NOW = Date.parse('2026-10-12T03:00:00Z');
const ev = (at: number, output: number): UsageEvent => ({
  at,
  model: 'm',
  tokens: { input: 0, output, cacheRead: 0, cacheWrite: 0, messages: 1 },
});

describe('windowTotals', () => {
  it('sums only events inside the official window', () => {
    const resetsAtSec = (NOW + 2 * H) / 1000; // window opened at NOW - 3h
    const w = windowTotals([ev(NOW - 4 * H, 1000), ev(NOW - 2 * H, 10), ev(NOW - H, 5)], resetsAtSec, NOW);
    expect(w.start).toBe(NOW - 3 * H);
    expect(w.end).toBe(NOW + 2 * H);
    expect(w.totals.output).toBe(15);
    expect(w.totals.messages).toBe(2);
  });
});

describe('estimateRemaining', () => {
  it('scales used tokens by the used percentage', () => {
    expect(estimateRemaining(400_000, 40)).toEqual({ limit: 1_000_000, remaining: 600_000 });
  });

  it('never goes negative once the limit is passed', () => {
    expect(estimateRemaining(1_200_000, 104)?.remaining).toBe(0);
  });

  it('declines to guess from a tiny sample', () => {
    expect(estimateRemaining(5_000, 0.5)).toBeUndefined();
    expect(estimateRemaining(0, 30)).toBeUndefined();
  });
});

describe('projectPace', () => {
  const start = NOW - 2 * H;
  const end = start + 5 * H;

  it('predicts when the limit is reached before the reset', () => {
    // 60% in 2h → 30%/h → the remaining 40% takes 1h20m.
    const p = projectPace(60, start, end, NOW);
    expect(p.elapsedPct).toBe(40);
    expect(p.kind).toBe('limit');
    expect(p.kind === 'limit' && p.at).toBe(NOW + 80 * 60_000);
  });

  it('predicts how much will be left at the reset', () => {
    // 20% in 2h → 50% by the end of the window.
    const p = projectPace(20, start, end, NOW);
    expect(p.kind).toBe('spare');
    expect(p.kind === 'spare' && p.leftPct).toBe(50);
  });

  it('waits for enough of the window before projecting', () => {
    expect(projectPace(10, NOW - 5 * 60_000, NOW + 295 * 60_000, NOW).kind).toBe('early');
  });

  it('reports a reached limit', () => {
    expect(projectPace(100, start, end, NOW).kind).toBe('reached');
  });
});
