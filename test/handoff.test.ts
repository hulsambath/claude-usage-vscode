import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateHandoffPrompt, saveHandoffFile } from '../src/handoff';
import { SessionView } from '../src/types';

describe('generateHandoffPrompt', () => {
  it('creates handoff prompt from Claude Code to Antigravity', () => {
    const session: SessionView = {
      sessionId: 'claude-sess-1',
      agent: 'claude',
      title: 'Implement OAuth Login',
      inWorkspace: true,
      live: {
        pid: 1234,
        sessionId: 'claude-sess-1',
        cwd: '/Users/apple/project',
        name: 'claude-sess-1',
        status: 'busy',
        updatedAt: Date.now(),
      },
      userPrompt: 'Please implement OAuth login using Google provider',
      filesTouched: ['/Users/apple/project/src/auth.ts', '/Users/apple/project/src/config.ts'],
      commandsRun: ['npm test', 'git status'],
      lastThinking: 'Authentication flow structure is complete, need to test token refresh.',
    };

    const prompt = generateHandoffPrompt({ sourceSession: session });

    expect(prompt).toContain('# 🔄 Context Bridge: Handoff from Claude Code to Antigravity');
    expect(prompt).toContain('Please implement OAuth login using Google provider');
    expect(prompt).toContain('- `/Users/apple/project/src/auth.ts`');
    expect(prompt).toContain('- `/Users/apple/project/src/config.ts`');
    expect(prompt).toContain('- `npm test`');
    expect(prompt).toContain('Authentication flow structure is complete, need to test token refresh.');
    expect(prompt).toContain('You are taking over this task from Claude Code');
  });

  it('creates handoff prompt from Antigravity to Claude Code', () => {
    const session: SessionView = {
      sessionId: 'agy-sess-2',
      agent: 'antigravity',
      title: 'Fix SQLite Database Lock',
      inWorkspace: true,
      userPrompt: 'Fix the SQLite lock issue when querying summaries',
      filesTouched: ['src/collector.ts'],
      commandsRun: ['sqlite3 test.db ".schema"'],
    };

    const prompt = generateHandoffPrompt({ sourceSession: session });

    expect(prompt).toContain('# 🔄 Context Bridge: Handoff from Antigravity to Claude Code');
    expect(prompt).toContain('Fix the SQLite lock issue when querying summaries');
    expect(prompt).toContain('- `src/collector.ts`');
    expect(prompt).toContain('You are taking over this task from Antigravity');
  });
});

describe('saveHandoffFile', () => {
  it('writes handoff content to workspace directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-test-'));
    const content = '# Context Handoff\n\nTask details here';
    const filePath = await saveHandoffFile(dir, content, '.agent-handoff.md');

    expect(filePath).toBe(join(dir, '.agent-handoff.md'));
    const written = readFileSync(filePath, 'utf8');
    expect(written).toBe(content);
  });
});
