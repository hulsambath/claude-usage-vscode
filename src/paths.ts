import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultClaudeRoot = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

export const paths = (root: string) => ({
  root,
  settings: join(root, 'settings.json'),
  liveSessions: join(root, 'sessions'),
  projects: join(root, 'projects'),
  monitor: join(root, 'usage-monitor'),
  bridgeSnapshots: join(root, 'usage-monitor', 'sessions'),
  installedBridge: join(root, 'usage-monitor', 'statusline-bridge.js'),
});
