import { BridgeSnapshot, RateLimits, RateWindow } from './types';

type WindowKey = 'five_hour' | 'seven_day';

/**
 * The quota is account-wide, so any session's latest status line report is
 * valid for all of them. Each window comes from the freshest snapshot still
 * inside that window; one whose reset time has passed is stale and dropped.
 */
export function pickRateLimits(snaps: BridgeSnapshot[], nowMs: number): RateLimits | undefined {
  const sorted = [...snaps].sort((a, b) => b.written_at - a.written_at);

  const pick = (key: WindowKey): { win: RateWindow; snap: BridgeSnapshot } | undefined => {
    for (const s of sorted) {
      const w = s.rate_limits?.[key];
      if (!w || typeof w.used_percentage !== 'number' || typeof w.resets_at !== 'number') continue;
      if (w.resets_at * 1000 <= nowMs) continue;
      return { win: { usedPercentage: w.used_percentage, resetsAt: w.resets_at }, snap: s };
    }
    return undefined;
  };

  const five = pick('five_hour');
  const seven = pick('seven_day');
  const source = five?.snap ?? seven?.snap;
  if (!source) return undefined;
  return { fiveHour: five?.win, sevenDay: seven?.win, observedAt: source.written_at, sessionId: source.session_id };
}
