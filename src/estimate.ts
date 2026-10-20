import { BlockUsage, UsageEvent, addTotals, emptyTotals } from './types';

const WINDOW_MS = 5 * 3_600_000;

/** Tokens from local transcripts that fall inside the official 5-hour window. */
export function windowTotals(events: UsageEvent[], resetsAtSec: number, nowMs: number): BlockUsage {
  const end = resetsAtSec * 1000;
  const start = end - WINDOW_MS;
  let totals = emptyTotals();
  for (const e of events) {
    if (e.at >= start && e.at <= nowMs) totals = addTotals(totals, e.tokens);
  }
  return { start, end, totals };
}

/**
 * Anthropic reports the quota only as a percentage. Assuming the tokens seen
 * so far explain that percentage, scale them up to an estimated limit.
 * Below 1% used, or with no tokens, the ratio is too noisy to show.
 */
export function estimateRemaining(usedTokens: number, usedPct: number): { limit: number; remaining: number } | undefined {
  if (usedPct < 1 || usedTokens <= 0) return undefined;
  const limit = Math.round(usedTokens / (usedPct / 100));
  return { limit, remaining: Math.max(0, limit - usedTokens) };
}

export type Pace =
  | { kind: 'early'; elapsedPct: number }
  | { kind: 'reached'; elapsedPct: number }
  | { kind: 'limit'; elapsedPct: number; at: number }
  | { kind: 'spare'; elapsedPct: number; leftPct: number };

/** Extrapolates the current burn rate to the end of the window. */
export function projectPace(usedPct: number, start: number, end: number, nowMs: number): Pace {
  const span = end - start;
  const elapsed = Math.min(Math.max(nowMs - start, 0), span);
  const elapsedPct = Math.round((elapsed / span) * 100);
  if (usedPct >= 100) return { kind: 'reached', elapsedPct };
  if (elapsed < 15 * 60_000 || usedPct <= 0) return { kind: 'early', elapsedPct };
  const perMs = usedPct / elapsed;
  const at = nowMs + (100 - usedPct) / perMs;
  if (at < end) return { kind: 'limit', elapsedPct, at: Math.round(at) };
  return { kind: 'spare', elapsedPct, leftPct: Math.max(0, Math.round(100 - perMs * span)) };
}
