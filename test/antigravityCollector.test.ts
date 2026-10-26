import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AntigravityCollector } from '../src/antigravityCollector';

const NOW = Date.parse('2026-10-26T12:00:00Z');

let root: string;

function writeTranscript(brainDir: string, sessionId: string, lines: string[]) {
  const dir = join(brainDir, sessionId, '.system_generated', 'logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'transcript.jsonl'), lines.join('\n'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agy-root-'));
  const transcript1 = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Fix build errors</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: new Date(NOW - 1000).toISOString(),
      input_tokens: 1000,
      cache_read_tokens: 500,
      output_tokens: 200,
      tool_calls: [
        { name: 'write_file', args: { Path: '"/ws/app/lib/main.dart"' } },
        { name: 'run_command', args: { CommandLine: '"flutter test"' } },
      ],
    }),
  ];
  writeTranscript(join(root, 'brain'), 'agy-1', transcript1);

  const transcript2 = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Other task</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: new Date(NOW - 2000).toISOString(),
      input_tokens: 500,
      cache_read_tokens: 100,
      output_tokens: 50,
    }),
  ];
  writeTranscript(join(root, 'brain'), 'agy-2', transcript2);
});

describe('AntigravityCollector', () => {
  it('discovers and collects sessions using sqlite3 query output', async () => {
    const mockSqlite = async () =>
      JSON.stringify([
        {
          id: 'agy-1',
          title: 'Fix build errors',
          status: 'CASCADE_RUN_STATUS_RUNNING',
          not_fully_idle: 1,
          killed: 0,
          last_modified_time: new Date(NOW - 500).toISOString(),
          workspace_uris: '["file:///ws/app"]',
        },
        {
          id: 'agy-2',
          title: 'Other task',
          status: 'CASCADE_RUN_STATUS_IDLE',
          not_fully_idle: 0,
          killed: 0,
          last_modified_time: new Date(NOW - 1500).toISOString(),
          workspace_uris: '["file:///other/app"]',
        },
      ]);

    const collector = new AntigravityCollector(root, mockSqlite);
    const { sessions, events } = await collector.collect(['/ws'], 'all', NOW);

    expect(sessions).toHaveLength(2);
    const s1 = sessions.find((s) => s.sessionId === 'agy-1')!;
    expect(s1.agent).toBe('antigravity');
    expect(s1.title).toBe('Fix build errors');
    expect(s1.live?.status).toBe('busy');
    expect(s1.inWorkspace).toBe(true);
    expect(s1.filesTouched).toEqual(['/ws/app/lib/main.dart']);
    expect(s1.commandsRun).toEqual(['flutter test']);
    expect(s1.usage?.totals.output).toBe(200);
    expect(s1.bridge?.context_tokens).toBe(1500); // 1000 in + 500 cacheRead

    const s2 = sessions.find((s) => s.sessionId === 'agy-2')!;
    expect(s2.inWorkspace).toBe(false);
    expect(s2.live?.status).toBe('idle');

    expect(events.length).toBe(2);
  });

  it('filters by workspace when scope is workspace', async () => {
    const mockSqlite = async () =>
      JSON.stringify([
        {
          id: 'agy-1',
          title: 'Fix build errors',
          status: 'CASCADE_RUN_STATUS_RUNNING',
          not_fully_idle: 1,
          killed: 0,
          last_modified_time: new Date(NOW - 500).toISOString(),
          workspace_uris: '["file:///ws/app"]',
        },
        {
          id: 'agy-2',
          title: 'Other task',
          status: 'CASCADE_RUN_STATUS_IDLE',
          not_fully_idle: 0,
          killed: 0,
          last_modified_time: new Date(NOW - 1500).toISOString(),
          workspace_uris: '["file:///other/app"]',
        },
      ]);

    const collector = new AntigravityCollector(root, mockSqlite);
    const { sessions } = await collector.collect(['/ws'], 'workspace', NOW);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('agy-1');
  });

  it('falls back to scanning brain directory if sqlite query fails', async () => {
    const failingSqlite = async () => {
      throw new Error('sqlite3 command not found');
    };

    const collector = new AntigravityCollector(root, failingSqlite);
    const { sessions } = await collector.collect(['/ws'], 'all', NOW);

    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const s1 = sessions.find((s) => s.sessionId === 'agy-1');
    expect(s1).toBeDefined();
    expect(s1?.agent).toBe('antigravity');
    expect(s1?.filesTouched).toEqual(['/ws/app/lib/main.dart']);
  });
});
