import { describe, expect, it } from 'vitest';
import { parseLiveSessions } from '../src/liveSessions';

const file = (pid: number, sessionId: string, updatedAt: number, extra: object = {}) => ({
  name: `${pid}.json`,
  text: JSON.stringify({ pid, sessionId, cwd: '/w', name: `s-${pid}`, status: 'idle', updatedAt, ...extra }),
});

describe('parseLiveSessions', () => {
  it('parses session files newest first', () => {
    const r = parseLiveSessions([file(1, 'a', 100), file(2, 'b', 200, { status: 'busy' })], () => true);
    expect(r.map((s) => s.sessionId)).toEqual(['b', 'a']);
    expect(r[0]).toEqual({ pid: 2, sessionId: 'b', cwd: '/w', name: 's-2', status: 'busy', updatedAt: 200 });
  });

  it('filters dead pids', () => {
    const r = parseLiveSessions([file(1, 'a', 100), file(2, 'b', 200)], (pid) => pid === 2);
    expect(r.map((s) => s.pid)).toEqual([2]);
  });

  it('skips malformed files and files without a session id', () => {
    const r = parseLiveSessions(
      [{ name: 'x.json', text: '{oops' }, { name: 'y.json', text: JSON.stringify({ pid: 3 }) }, file(4, 'd', 1)],
      () => true,
    );
    expect(r.map((s) => s.sessionId)).toEqual(['d']);
  });

  it('keeps the newest entry when two pids report the same session', () => {
    const r = parseLiveSessions([file(1, 'a', 100), file(2, 'a', 300)], () => true);
    expect(r).toHaveLength(1);
    expect(r[0].pid).toBe(2);
  });
});
