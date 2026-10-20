import { LiveSession } from './types';

/**
 * Claude Code keeps one ~/.claude/sessions/<pid>.json per running window.
 * Files outlive crashed processes, so each pid is checked for liveness.
 */
export function parseLiveSessions(
  files: { name: string; text: string }[],
  isAlive: (pid: number) => boolean,
): LiveSession[] {
  const bySession = new Map<string, LiveSession>();
  for (const f of files) {
    let d: any;
    try {
      d = JSON.parse(f.text);
    } catch {
      continue;
    }
    if (typeof d?.sessionId !== 'string' || typeof d.pid !== 'number') continue;
    if (!isAlive(d.pid)) continue;
    const s: LiveSession = {
      pid: d.pid,
      sessionId: d.sessionId,
      cwd: typeof d.cwd === 'string' ? d.cwd : '',
      name: typeof d.name === 'string' ? d.name : d.sessionId.slice(0, 8),
      status: typeof d.status === 'string' ? d.status : 'unknown',
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    };
    const prev = bySession.get(s.sessionId);
    if (!prev || prev.updatedAt < s.updatedAt) bySession.set(s.sessionId, s);
  }
  return [...bySession.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** process.kill(pid, 0) probes without signalling; EPERM still means alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}
