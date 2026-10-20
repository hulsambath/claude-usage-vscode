import { describe, expect, it } from 'vitest';
import { focusFirst } from '../src/focus';

describe('focusFirst', () => {
  it('uses the first view whose focus command exists', async () => {
    const ran: string[] = [];
    const exec = async (id: string) => {
      ran.push(id);
      if (id === 'a.focus') throw new Error("command 'a.focus' not found");
    };
    expect(await focusFirst(['a', 'b', 'c'], exec)).toBe('b');
    expect(ran).toEqual(['a.focus', 'b.focus']);
  });

  it('returns undefined when no view is registered yet', async () => {
    expect(await focusFirst(['a', 'b'], async () => Promise.reject(new Error('not found')))).toBeUndefined();
  });
});
