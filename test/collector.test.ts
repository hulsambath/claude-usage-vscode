import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Collector } from '../src/collector';

const H = 3_600_000;
const NOW = Date.parse('2026-10-12T03:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const line = (id: string, at: number, output: number, cwd: string) =>
  JSON.stringify({
    type: 'assistant',
    requestId: `r-${id}`,
    timestamp: iso(at),
    cwd,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output } },
  });

function write(path: string, text: string, mtimeMs = NOW) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cu-root-'));
  // Live window in the workspace; its transcript sits under an older slug.
  write(join(root, 'sessions', '100.json'), JSON.stringify({ pid: 100, sessionId: 'aaa', cwd: '/ws/app', name: 'app-1', status: 'busy', updatedAt: NOW }));
  write(join(root, 'projects', '-old-slug', 'aaa.jsonl'), [line('m1', NOW - H, 10, '/ws/app'), line('m2', NOW - 30 * 60_000, 20, '/ws/app')].join('\n'));
  write(join(root, 'projects', '-old-slug', 'aaa', 'subagents', 'agent-1.jsonl'), line('m3', NOW - 20 * 60_000, 5, '/ws/app'));
  // Dead window outside the workspace, still active within the last 5 h.
  write(join(root, 'sessions', '200.json'), JSON.stringify({ pid: 200, sessionId: 'bbb', cwd: '/other', name: 'other', status: 'idle', updatedAt: NOW - H }));
  write(join(root, 'projects', '-other', 'bbb.jsonl'), line('m4', NOW - 2 * H, 100, '/other'));
  // Old transcript: neither live nor recent.
  write(join(root, 'projects', '-other', 'ccc.jsonl'), line('m5', NOW - 30 * H, 1000, '/other'), NOW - 30 * H);
  // Quota reported through the status line bridge.
  write(
    join(root, 'usage-monitor', 'sessions', 'aaa.json'),
    JSON.stringify({ session_id: 'aaa', written_at: NOW - 5_000, context_used_percentage: 40, rate_limits: { five_hour: { used_percentage: 42, resets_at: NOW / 1000 + 3600 } } }),
  );
  write(join(root, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'node /x/statusline-bridge.js' } }));
});

const alive = (pid: number) => pid === 100;

describe('Collector', () => {
  it('lists all recent sessions with merged subagent usage', async () => {
    const snap = await new Collector(root, alive).collect(['/ws'], 'all', NOW);
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(['aaa', 'bbb']);
    const [aaa, bbb] = snap.sessions;
    expect(aaa.live?.name).toBe('app-1');
    expect(aaa.inWorkspace).toBe(true);
    expect(aaa.usage?.totals.output).toBe(35);
    expect(aaa.usage?.totals.messages).toBe(3);
    expect(aaa.bridge?.context_used_percentage).toBe(40);
    expect(aaa.transcriptPath).toBe(join(root, 'projects', '-old-slug', 'aaa.jsonl'));
    expect(bbb.live).toBeUndefined();
    expect(bbb.inWorkspace).toBe(false);
  });

  it('reports the official quota and the local block', async () => {
    const snap = await new Collector(root, alive).collect(['/ws'], 'all', NOW);
    expect(snap.rateLimits?.fiveHour?.usedPercentage).toBe(42);
    expect(snap.bridgeInstalled).toBe(true);
    // Block opens at 01:00 (first recent message floored), the old ccc message is long gone.
    expect(snap.block?.start).toBe(NOW - 2 * H);
    expect(snap.block?.totals.output).toBe(135);
  });

  it('totals the tokens inside the official window', async () => {
    const snap = await new Collector(root, alive).collect(['/ws'], 'all', NOW);
    // Window ends NOW + 1h, so it opened at NOW - 4h and covers every recent message.
    expect(snap.quotaWindow?.start).toBe(NOW - 4 * H);
    expect(snap.quotaWindow?.totals.output).toBe(135);
  });

  it('workspace scope hides other sessions but still counts them in the block', async () => {
    const snap = await new Collector(root, alive).collect(['/ws'], 'workspace', NOW);
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(['aaa']);
    expect(snap.block?.totals.output).toBe(135);
  });

  it('reuses parsed transcripts that have not changed', async () => {
    const c = new Collector(root, alive);
    await c.collect(['/ws'], 'all', NOW);
    const first = c.parseCount;
    await c.collect(['/ws'], 'all', NOW);
    expect(c.parseCount).toBe(first);
    write(join(root, 'projects', '-other', 'bbb.jsonl'), [line('m4', NOW - 2 * H, 100, '/other'), line('m6', NOW - H, 1, '/other')].join('\n'), NOW + 1000);
    await c.collect(['/ws'], 'all', NOW);
    expect(c.parseCount).toBe(first + 1);
  });

  it('copes with an empty ~/.claude', async () => {
    const snap = await new Collector(mkdtempSync(join(tmpdir(), 'cu-empty-')), alive).collect([], 'all', NOW);
    expect(snap).toMatchObject({ sessions: [], bridgeInstalled: false });
    expect(snap.rateLimits).toBeUndefined();
    expect(snap.block).toBeUndefined();
    expect(snap.quotaWindow).toBeUndefined();
  });
});
