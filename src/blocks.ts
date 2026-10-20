import { BlockUsage, UsageEvent, addTotals, emptyTotals } from './types';

const HOUR = 3_600_000;
const BLOCK = 5 * HOUR;

/**
 * Local estimate of the 5-hour window, used when the official quota is not
 * available: a block opens at the first message (floored to the hour) and a
 * message at or past its end opens the next one. Returns the block still
 * running at `nowMs`, if any.
 */
export function currentBlock(events: UsageEvent[], nowMs: number): BlockUsage | undefined {
  const sorted = events.filter((e) => e.at > 0).sort((a, b) => a.at - b.at);
  let block: BlockUsage | undefined;
  for (const e of sorted) {
    if (!block || e.at >= block.end) {
      const start = Math.floor(e.at / HOUR) * HOUR;
      block = { start, end: start + BLOCK, totals: emptyTotals() };
    }
    block.totals = addTotals(block.totals, e.tokens);
  }
  return block && nowMs < block.end ? block : undefined;
}
