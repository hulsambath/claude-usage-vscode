import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentType, SessionView } from './types';

export interface HandoffOptions {
  sourceSession: SessionView;
  targetAgent?: AgentType;
}

export function generateHandoffPrompt(options: HandoffOptions): string {
  const { sourceSession } = options;
  const sourceAgent: AgentType = sourceSession.agent ?? 'claude';
  const targetAgent: AgentType = options.targetAgent ?? (sourceAgent === 'claude' ? 'antigravity' : 'claude');

  const sourceName = sourceAgent === 'claude' ? 'Claude Code' : 'Antigravity';
  const targetName = targetAgent === 'claude' ? 'Claude Code' : 'Antigravity';

  const lines: string[] = [];
  lines.push(`# 🔄 Context Bridge: Handoff from ${sourceName} to ${targetName}`);
  lines.push(`> Source Session: **${sourceSession.title || sourceSession.live?.name || sourceSession.sessionId}**`);
  const folder = sourceSession.live?.cwd || sourceSession.usage?.cwd;
  if (folder) {
    lines.push(`> Workspace: \`${folder}\``);
  }
  lines.push('');

  lines.push('## 🎯 Task Objective & Context');
  if (sourceSession.userPrompt) {
    lines.push(sourceSession.userPrompt);
  } else if (sourceSession.title) {
    lines.push(sourceSession.title);
  } else {
    lines.push('Continuing existing work from the previous agent session.');
  }
  lines.push('');

  if (sourceSession.filesTouched && sourceSession.filesTouched.length > 0) {
    lines.push('## 📂 Files Modified / Created So Far');
    for (const file of sourceSession.filesTouched) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  if (sourceSession.commandsRun && sourceSession.commandsRun.length > 0) {
    lines.push('## 💻 Key Commands Executed');
    for (const cmd of sourceSession.commandsRun.slice(-10)) {
      lines.push(`- \`${cmd}\``);
    }
    lines.push('');
  }

  if (sourceSession.lastThinking) {
    lines.push('## 🧠 Latest State & Findings');
    lines.push(sourceSession.lastThinking);
    lines.push('');
  }

  lines.push('## 🚀 Instructions for Next Agent');
  lines.push(
    `You are taking over this task from ${sourceName}. Review the files modified above and latest findings, inspect the current workspace, and continue completing the task without repeating prior work.`,
  );

  return lines.join('\n');
}

export async function saveHandoffFile(
  workspacePath: string,
  content: string,
  filename = '.agent-handoff.md',
): Promise<string> {
  const filePath = join(workspacePath, filename);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
