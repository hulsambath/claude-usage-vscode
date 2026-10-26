import { describe, expect, it } from 'vitest';
import { renderBody } from '../src/render';
import { buildViewModel } from '../src/viewModel';
import { SessionView, UsageSnapshot } from '../src/types';

const NOW = Date.parse('2026-10-26T12:00:00Z');

describe('multi-agent viewModel', () => {
  const claudeSession: SessionView = {
    sessionId: 'c-1',
    agent: 'claude',
    title: 'Claude Refactoring',
    inWorkspace: true,
    live: {
      pid: 100,
      sessionId: 'c-1',
      cwd: '/ws/app',
      name: 'c-1',
      status: 'idle',
      updatedAt: NOW - 5000,
    },
    usage: {
      sessionId: 'c-1',
      totals: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0, messages: 1 },
      byModel: { 'claude-opus-5-5': { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0, messages: 1 } },
      events: [],
    },
    filesTouched: ['/ws/app/src/index.ts'],
  };

  const agySession: SessionView = {
    sessionId: 'a-1',
    agent: 'antigravity',
    title: 'Antigravity Build Fix',
    inWorkspace: true,
    live: {
      pid: 0,
      sessionId: 'a-1',
      cwd: '/ws/app',
      name: 'a-1',
      status: 'busy',
      updatedAt: NOW - 1000,
    },
    usage: {
      sessionId: 'a-1',
      totals: { input: 2000, output: 400, cacheRead: 1000, cacheWrite: 0, messages: 2 },
      byModel: { 'Gemini 3.8 Flash': { input: 2000, output: 400, cacheRead: 1000, cacheWrite: 0, messages: 2 } },
      events: [],
    },
    filesTouched: ['/ws/app/lib/main.dart'],
    userPrompt: 'Fix simulator build',
  };

  const snap: UsageSnapshot = {
    sessions: [agySession, claudeSession],
    bridgeInstalled: true,
    takenAt: NOW,
    antigravityTotals: { input: 2000, output: 400, cacheRead: 1000, cacheWrite: 0, messages: 2 },
    claudeTotals: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0, messages: 1 },
    rateLimits: {
      fiveHour: { usedPercentage: 40, resetsAt: (NOW + 3600_000) / 1000 },
      observedAt: NOW,
      sessionId: 'c-1',
    },
  };

  it('renders both agents and reports counts and Antigravity usage in quota', () => {
    const vm = buildViewModel(snap, 80, 'all');

    expect(vm.quota.counts).toEqual({ all: 2, claude: 1, antigravity: 1 });
    expect(vm.quota.antigravityUsage?.tokens).toBe('3.4k');
    expect(vm.quota.antigravityUsage?.count).toBe(1);
    expect(vm.quota.antigravityUsage?.activeCount).toBe(1);

    expect(vm.sessions).toHaveLength(2);
    expect(vm.sessions[0].agent).toBe('antigravity');
    expect(vm.sessions[1].agent).toBe('claude');
  });

  it('filters sessions by agent', () => {
    const vmClaude = buildViewModel(snap, 80, 'claude');
    expect(vmClaude.sessions).toHaveLength(1);
    expect(vmClaude.sessions[0].agent).toBe('claude');

    const vmAgy = buildViewModel(snap, 80, 'antigravity');
    expect(vmAgy.sessions).toHaveLength(1);
    expect(vmAgy.sessions[0].agent).toBe('antigravity');
  });

  it('generates context bridge handoff prompt for each session', () => {
    const vm = buildViewModel(snap, 80, 'all');
    const agyVm = vm.sessions.find((s) => s.agent === 'antigravity')!;
    expect(agyVm.handoffPrompt).toContain('# 🔄 Context Bridge: Handoff from Antigravity to Claude Code');
    expect(agyVm.handoffPrompt).toContain('/ws/app/lib/main.dart');

    const claudeVm = vm.sessions.find((s) => s.agent === 'claude')!;
    expect(claudeVm.handoffPrompt).toContain('# 🔄 Context Bridge: Handoff from Claude Code to Antigravity');
    expect(claudeVm.handoffPrompt).toContain('/ws/app/src/index.ts');
  });

  it('includes contextBridge recommendation pointing to the most recent session', () => {
    const vm = buildViewModel(snap, 80, 'all');
    expect(vm.quota.contextBridge).toEqual({
      sourceSessionId: 'a-1',
      sourceTitle: 'Antigravity Build Fix',
      sourceAgent: 'antigravity',
      targetAgent: 'claude',
    });
  });

  it('supports two-way context handoff between Claude and Antigravity', () => {
    const vm = buildViewModel(snap, 80, 'all');
    expect(vm.quota.contextBridges?.toClaude).toEqual({
      sourceSessionId: 'a-1',
      sourceTitle: 'Antigravity Build Fix',
      sourceAgent: 'antigravity',
      targetAgent: 'claude',
    });
    expect(vm.quota.contextBridges?.toAntigravity).toEqual({
      sourceSessionId: 'c-1',
      sourceTitle: 'Claude Refactoring',
      sourceAgent: 'claude',
      targetAgent: 'antigravity',
    });

    const html = renderBody(vm);
    expect(html).toContain('Copy Handoff to Claude');
    expect(html).toContain('Copy Handoff to Antigravity');
  });

  it('renders dual graphs for both Claude and Antigravity in HTML', () => {
    const vm = buildViewModel(snap, 80, 'all');
    const html = renderBody(vm);

    expect(html).toContain('class="dual-graphs"');
    expect(html).toContain('class="agent-graph-card claude');
    expect(html).toContain('class="agent-graph-card antigravity');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Antigravity');
    expect(html).toContain('3.4k tokens used');
    expect(html).toContain('60% left');
  });
});
