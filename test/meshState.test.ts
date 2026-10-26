import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMeshMessage, getMeshInbox, readMeshState, updateMessageStatus } from '../src/orchestrator/meshState';

describe('MeshState', () => {
  let tmpFile: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mesh-test-'));
    tmpFile = join(tmpDir, 'mesh.json');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('reads empty mesh state when file does not exist', async () => {
    const state = await readMeshState(tmpFile);
    expect(state.version).toBe(1);
    expect(state.messages).toEqual([]);
    expect(state.activeAgents).toHaveLength(2);
  });

  it('adds a message and retrieves it via inbox', async () => {
    const msg = await addMeshMessage(
      {
        fromAgent: 'claude',
        toAgent: 'antigravity',
        type: 'task_delegation',
        subject: 'Create Flutter Auth View',
        content: 'Please create LoginScreen and SignUpScreen widgets.',
        contextFiles: ['/app/models.dart'],
      },
      tmpFile,
    );

    expect(msg.id).toContain('msg-');
    expect(msg.status).toBe('unread');

    const inbox = await getMeshInbox('antigravity', false, tmpFile);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject).toBe('Create Flutter Auth View');

    const claudeInbox = await getMeshInbox('claude', false, tmpFile);
    expect(claudeInbox).toHaveLength(0);

    const updated = await updateMessageStatus(msg.id, 'completed', tmpFile);
    expect(updated).toBe(true);

    const unread = await getMeshInbox('antigravity', true, tmpFile);
    expect(unread).toHaveLength(0);
  });
});
