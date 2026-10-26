import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultAntigravityRoot = (): string => {
  if (process.env.ANTIGRAVITY_CONFIG_DIR) return process.env.ANTIGRAVITY_CONFIG_DIR;
  const cli = join(homedir(), '.gemini', 'antigravity-cli');
  if (existsSync(cli)) return cli;
  return join(homedir(), '.gemini', 'antigravity');
};

export const antigravityPaths = (root: string) => ({
  root,
  brain: join(root, 'brain'),
  presence: join(root, 'presence'),
  conversationSummariesDb: join(root, 'conversation_summaries.db'),
  historyJsonl: join(root, 'history.jsonl'),
  settingsJson: join(root, 'settings.json'),
});
