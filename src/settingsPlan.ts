export type StatusLinePlan =
  | { action: 'install'; text: string }
  | { action: 'already' }
  | { action: 'conflict'; existing: string }
  | { action: 'invalid' };

/**
 * Decides how to point ~/.claude/settings.json's statusLine at the bridge
 * without ever replacing a status line the user configured themselves.
 */
export function planStatusLineInstall(settingsText: string | undefined, command: string): StatusLinePlan {
  let settings: Record<string, unknown> = {};
  if (settingsText !== undefined && settingsText.trim() !== '') {
    try {
      const parsed = JSON.parse(settingsText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { action: 'invalid' };
      settings = parsed;
    } catch {
      return { action: 'invalid' };
    }
  }

  const current = settings.statusLine as { command?: unknown } | null | undefined;
  if (current) {
    const existing = typeof current.command === 'string' ? current.command : JSON.stringify(current);
    return existing === command ? { action: 'already' } : { action: 'conflict', existing };
  }

  const next = { ...settings, statusLine: { type: 'command', command } };
  return { action: 'install', text: `${JSON.stringify(next, null, 2)}\n` };
}

/**
 * The status line runs from whatever directory Claude Code is in, where
 * version-manager shims (asdf, nodenv) may have no version set and fail, so
 * the bridge is pinned to the first concrete node binary that exists.
 */
export function pickNodeBinary(candidates: string[], exists: (path: string) => boolean): string {
  return candidates.find((c) => !c.includes('/shims/') && exists(c)) ?? 'node';
}

export const bridgeCommand = (nodePath: string, scriptPath: string): string => `"${nodePath}" "${scriptPath}"`;
