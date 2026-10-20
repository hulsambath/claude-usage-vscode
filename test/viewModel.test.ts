import { describe, expect, it } from 'vitest';
import { buildViewModel } from '../src/viewModel';
import { SessionView, UsageSnapshot } from '../src/types';

const H = 3_600_000;
const NOW = new Date(2026, 9, 12, 2, 0).getTime(); // local 02:00
const tot = (output: number) => ({ input: 0, output, cacheRead: 0, cacheWrite: 0, messages: 3 });

const snap = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  sessions: [],
  bridgeInstalled: true,
  takenAt: NOW,
  ...over,
});

const official = (usedPct: number, resetIn = 3 * H): Partial<UsageSnapshot> => ({
  rateLimits: { fiveHour: { usedPercentage: usedPct, resetsAt: (NOW + resetIn) / 1000 }, observedAt: NOW, sessionId: 's' },
  quotaWindow: { start: NOW + resetIn - 5 * H, end: NOW + resetIn, totals: tot(400_000) },
});

describe('quota view model', () => {
  it('leads with what is left and estimates remaining tokens', () => {
    const q = buildViewModel(snap(official(40)), 80).quota;
    expect(q.state).toBe('official');
    expect(q.headline).toBe('60% left');
    expect(q.usedPct).toBe(40);
    expect(q.elapsedPct).toBe(40);
    expect(q.level).toBe('ok');
    expect(q.tokensLine).toBe('About 600.0k tokens left of roughly 1.0M');
    expect(q.tokensLeft).toBe('600.0k');
    expect(q.resetLine).toBe('Resets at 05:00, in 3h 00m');
  });

  it('warns at the configured threshold and turns critical at 95%', () => {
    expect(buildViewModel(snap(official(85)), 80).quota.level).toBe('warn');
    expect(buildViewModel(snap(official(96)), 80).quota.level).toBe('crit');
  });

  it('turns amber when the pace runs out before the reset', () => {
    expect(buildViewModel(snap(official(60)), 80).quota.level).toBe('warn');
  });

  it('writes the pace as a sentence', () => {
    // 60% used, 2h into the window: the limit arrives at 03:20, 1h 40m before the 05:00 reset.
    expect(buildViewModel(snap(official(60)), 80).quota.paceLine).toBe(
      "At this pace you'll hit the limit around 03:20, 1h 40m before it resets.",
    );
    expect(buildViewModel(snap(official(10)), 80).quota.paceLine).toBe(
      "At this pace you'll finish this window with about 75% to spare.",
    );
  });

  it('falls back to the local estimate without an official quota', () => {
    const q = buildViewModel(snap({ block: { start: NOW - H, end: NOW + 4 * H, totals: tot(1_200_000) } }), 80).quota;
    expect(q.state).toBe('local');
    expect(q.headline).toBe('1.2M tokens used');
    expect(q.resetLine).toBe('This 5-hour window ends at 06:00, in 4h 00m');
    expect(q.note?.text).toBe('The official percentage shows after your next Claude response.');
  });

  it('offers to install the bridge when it is missing', () => {
    const q = buildViewModel(snap({ bridgeInstalled: false }), 80).quota;
    expect(q.state).toBe('none');
    expect(q.headline).toBe('No usage in the last 5 hours');
    expect(q.note).toEqual({ text: 'Install the status line bridge to see your official quota.', action: 'install' });
  });

  it('shows the weekly limit', () => {
    const s = snap(official(40));
    s.rateLimits!.sevenDay = { usedPercentage: 16, resetsAt: (NOW + 50 * H) / 1000 };
    expect(buildViewModel(s, 80).quota.weekly).toEqual({ usedPct: 16, line: '16% of this week used, resets in 2d 2h', level: 'ok' });
  });
});

describe('session view model', () => {
  it('shortens home paths', () => {
    const home = process.env.HOME;
    process.env.HOME = '/Users/a';
    try {
      const s = buildViewModel(snap({ sessions: [{ sessionId: 'x', inWorkspace: true, usage: { sessionId: 'x', totals: tot(1), byModel: {}, events: [], cwd: '/Users/a/p' } }] }), 80).sessions[0];
      expect(s.details).toContainEqual(['Folder', '~/p']);
    } finally {
      process.env.HOME = home;
    }
  });

  const view = (over: Partial<SessionView>): SessionView => ({ sessionId: 'abcdef12-0000', inWorkspace: true, ...over });

  it('describes a busy window with context left', () => {
    const s = buildViewModel(
      snap({
        sessions: [
          view({
            live: { pid: 1, sessionId: 'abcdef12-0000', cwd: '/Users/a/project/balling', name: 'balling-3', status: 'busy', updatedAt: NOW - 60_000 },
            usage: { sessionId: 'x', title: 'Fix ingest', totals: tot(2_500_000), byModel: { 'claude-opus-5-5': tot(2_500_000) }, events: [], lastAt: NOW - 60_000 },
            bridge: { session_id: 'x', written_at: NOW, context_used_percentage: 30, context_window_size: 200_000, context_tokens: 60_000 },
            transcriptPath: '/t.jsonl',
          }),
        ],
      }),
      80,
    ).sessions[0];
    expect(s).toMatchObject({
      name: 'balling-3',
      title: 'Fix ingest',
      state: 'busy',
      tokens: '2.5M',
      canOpen: true,
      context: { usedPct: 30, line: '140.0k of 200.0k context tokens left' },
    });
    expect(s.meta).toBe('Working now in balling');
    expect(s.details).toContainEqual(['Output', '2.5M']);
    expect(s.details).toContainEqual(['claude-opus-5-5', '2.5M tokens, 3 messages']);
    expect(s.details).toContainEqual(['Folder', '/Users/a/project/balling']);
    expect(s.details.map(([k]) => k)).not.toContain('Session');
  });

  it('says when an idle window has only just replied', () => {
    const vm = buildViewModel(snap({ sessions: [{ sessionId: 'i', inWorkspace: true, live: { pid: 2, sessionId: 'i', cwd: '/x/app', name: 'app', status: 'idle', updatedAt: NOW - 10_000 } }] }), 80);
    expect(vm.sessions[0].meta).toBe('Idle, replied just now in app');
  });

  it('describes closed and idle windows by recency', () => {
    const vm = buildViewModel(
      snap({
        sessions: [
          view({ sessionId: 'closed01', usage: { sessionId: 'c', totals: tot(10), byModel: {}, events: [], lastAt: NOW - 2 * H, cwd: '/x/app' } }),
          view({ live: { pid: 2, sessionId: 'i', cwd: '/x/app', name: 'app', status: 'idle', updatedAt: NOW - 4 * 60_000 } }),
        ],
      }),
      80,
    );
    expect(vm.sessions[0]).toMatchObject({ name: 'closed01', state: 'closed', meta: 'Closed, last reply 2 h ago in app', tokens: '10' });
    expect(vm.sessions[1]).toMatchObject({ state: 'idle', meta: 'Idle for 4 min in app', tokens: '0', canOpen: false });
  });
});
