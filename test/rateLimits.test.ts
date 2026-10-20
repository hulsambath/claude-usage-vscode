import { describe, expect, it } from 'vitest';
import { pickRateLimits } from '../src/rateLimits';
import { BridgeSnapshot } from '../src/types';

const NOW = Date.parse('2026-10-12T02:00:00Z');
const inSec = (h: number) => Math.floor(NOW / 1000) + h * 3600;

const snap = (id: string, writtenAgoMs: number, rl?: BridgeSnapshot['rate_limits']): BridgeSnapshot => ({
  session_id: id,
  written_at: NOW - writtenAgoMs,
  rate_limits: rl,
});

describe('pickRateLimits', () => {
  it('uses the most recently written snapshot', () => {
    const r = pickRateLimits(
      [
        snap('old', 60_000, { five_hour: { used_percentage: 10, resets_at: inSec(2) } }),
        snap('new', 1_000, { five_hour: { used_percentage: 42, resets_at: inSec(2) } }),
      ],
      NOW,
    );
    expect(r?.fiveHour).toEqual({ usedPercentage: 42, resetsAt: inSec(2) });
    expect(r?.sessionId).toBe('new');
    expect(r?.observedAt).toBe(NOW - 1_000);
  });

  it('drops expired windows', () => {
    const r = pickRateLimits(
      [snap('a', 1_000, { five_hour: { used_percentage: 99, resets_at: inSec(-1) }, seven_day: { used_percentage: 30, resets_at: inSec(48) } })],
      NOW,
    );
    expect(r?.fiveHour).toBeUndefined();
    expect(r?.sevenDay?.usedPercentage).toBe(30);
  });

  it('returns undefined when every window has expired', () => {
    expect(pickRateLimits([snap('a', 1_000, { five_hour: { used_percentage: 99, resets_at: inSec(-1) } })], NOW)).toBeUndefined();
  });

  it('takes each window from the freshest snapshot that carries a live one', () => {
    const r = pickRateLimits(
      [
        snap('weekly', 30_000, { seven_day: { used_percentage: 55, resets_at: inSec(24) } }),
        snap('fresh', 1_000, { five_hour: { used_percentage: 12, resets_at: inSec(1) } }),
      ],
      NOW,
    );
    expect(r?.fiveHour?.usedPercentage).toBe(12);
    expect(r?.sevenDay?.usedPercentage).toBe(55);
  });

  it('ignores snapshots without rate limits', () => {
    expect(pickRateLimits([snap('a', 0)], NOW)).toBeUndefined();
  });
});
