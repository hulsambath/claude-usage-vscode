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

export interface DispatchMessageOptions {
  sourceSession: SessionView;
  targetSession?: SessionView;
  targetAgent?: AgentType;
  customMessage?: string;
  attachContext?: boolean;
}

export function generateDispatchMessage(options: DispatchMessageOptions): string {
  const { sourceSession, targetSession, customMessage, attachContext = true } = options;
  const sourceAgent: AgentType = sourceSession.agent ?? 'claude';
  const targetAgent: AgentType =
    targetSession?.agent ?? options.targetAgent ?? (sourceAgent === 'claude' ? 'antigravity' : 'claude');

  const sourceName = `${sourceAgent === 'claude' ? 'Claude Code' : 'Antigravity'} (${sourceSession.title || sourceSession.live?.name || sourceSession.sessionId.slice(0, 8)})`;
  const targetName = targetSession
    ? `${targetSession.agent === 'claude' ? 'Claude Code' : 'Antigravity'} (${targetSession.title || targetSession.live?.name || targetSession.sessionId.slice(0, 8)})`
    : targetAgent === 'claude'
      ? 'Claude Code'
      : 'Antigravity';

  const lines: string[] = [];
  lines.push(`💬 [Inter-Session Communication: ${sourceName} ➔ ${targetName}]`);
  lines.push('');

  if (customMessage && customMessage.trim()) {
    lines.push('### ✉️ Message / Instruction:');
    lines.push(customMessage.trim());
    lines.push('');
  }

  if (attachContext) {
    lines.push('### 📋 Context from Sender:');
    if (sourceSession.userPrompt) {
      lines.push(`- **Goal/Prompt:** ${sourceSession.userPrompt}`);
    } else if (sourceSession.title) {
      lines.push(`- **Goal/Prompt:** ${sourceSession.title}`);
    }

    if (sourceSession.filesTouched && sourceSession.filesTouched.length > 0) {
      const files = sourceSession.filesTouched.slice(-8).map((f) => `\`${f}\``).join(', ');
      lines.push(`- **Files touched:** ${files}`);
    }

    if (sourceSession.commandsRun && sourceSession.commandsRun.length > 0) {
      const cmds = sourceSession.commandsRun.slice(-5).map((c) => `\`${c}\``).join(', ');
      lines.push(`- **Recent commands:** ${cmds}`);
    }

    if (sourceSession.lastThinking) {
      lines.push(`- **Latest findings/state:** ${sourceSession.lastThinking}`);
    }

    lines.push('');
    lines.push(`Please incorporate the above message and context from ${sourceName} into your ongoing work.`);
  }

  return lines.join('\n');
}
