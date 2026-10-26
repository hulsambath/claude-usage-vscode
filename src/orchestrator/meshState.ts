import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AgentMeshMessage, MeshState } from './types';

export function defaultMeshStatePath(): string {
  return join(homedir(), '.claude', 'agent-mesh-state.json');
}

export function defaultMeshInboxDir(): string {
  return join(homedir(), '.claude', 'mesh-inbox');
}

export function emptyMeshState(): MeshState {
  return {
    version: 1,
    lastUpdated: Date.now(),
    activeAgents: [
      { agent: 'claude', status: 'idle', lastActive: Date.now() },
      { agent: 'antigravity', status: 'idle', lastActive: Date.now() },
    ],
    messages: [],
  };
}

export async function readMeshState(filePath = defaultMeshStatePath()): Promise<MeshState> {
  if (!existsSync(filePath)) {
    return emptyMeshState();
  }
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) {
      return emptyMeshState();
    }
    return parsed as MeshState;
  } catch {
    return emptyMeshState();
  }
}

export async function writeMeshState(state: MeshState, filePath = defaultMeshStatePath()): Promise<void> {
  state.lastUpdated = Date.now();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function addMeshMessage(
  msg: Omit<AgentMeshMessage, 'id' | 'timestamp' | 'status'>,
  filePath = defaultMeshStatePath(),
): Promise<AgentMeshMessage> {
  const state = await readMeshState(filePath);
  const fullMsg: AgentMeshMessage = {
    ...msg,
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    status: 'unread',
  };

  state.messages.push(fullMsg);
  // Keep last 100 messages
  if (state.messages.length > 100) {
    state.messages = state.messages.slice(-100);
  }

  await writeMeshState(state, filePath);
  return fullMsg;
}

export async function getMeshInbox(
  agentName: string,
  unreadOnly = false,
  filePath = defaultMeshStatePath(),
): Promise<AgentMeshMessage[]> {
  const state = await readMeshState(filePath);
  const normalized = agentName.toLowerCase();
  return state.messages.filter((m) => {
    const match = m.toAgent.toLowerCase().includes(normalized) || m.toAgent.toLowerCase() === 'all';
    if (!match) return false;
    return unreadOnly ? m.status === 'unread' : true;
  });
}

export async function updateMessageStatus(
  messageId: string,
  status: AgentMeshMessage['status'],
  filePath = defaultMeshStatePath(),
): Promise<boolean> {
  const state = await readMeshState(filePath);
  const found = state.messages.find((m) => m.id === messageId);
  if (!found) return false;
  found.status = status;
  await writeMeshState(state, filePath);
  return true;
}
