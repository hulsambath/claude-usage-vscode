import { describe, expect, it } from 'vitest';
import { bridgeCommand, pickNodeBinary, planStatusLineInstall } from '../src/settingsPlan';

const CMD = 'node "/h/.claude/usage-monitor/statusline-bridge.js"';

describe('planStatusLineInstall', () => {
  it('creates settings when none exist', () => {
    const p = planStatusLineInstall(undefined, CMD);
    expect(p.action).toBe('install');
    expect(JSON.parse(p.text!)).toEqual({ statusLine: { type: 'command', command: CMD } });
  });

  it('keeps every other key', () => {
    const p = planStatusLineInstall(JSON.stringify({ model: 'opus', hooks: { Stop: [] } }), CMD);
    expect(p.action).toBe('install');
    expect(JSON.parse(p.text!)).toEqual({ model: 'opus', hooks: { Stop: [] }, statusLine: { type: 'command', command: CMD } });
  });

  it('treats a null statusLine as absent', () => {
    expect(planStatusLineInstall(JSON.stringify({ statusLine: null }), CMD).action).toBe('install');
  });

  it('reports an existing identical install', () => {
    const p = planStatusLineInstall(JSON.stringify({ statusLine: { type: 'command', command: CMD } }), CMD);
    expect(p.action).toBe('already');
  });

  it('never replaces a different status line', () => {
    const p = planStatusLineInstall(JSON.stringify({ statusLine: { type: 'command', command: 'my-line.sh' } }), CMD);
    expect(p).toEqual({ action: 'conflict', existing: 'my-line.sh' });
  });

  it('refuses invalid JSON', () => {
    expect(planStatusLineInstall('{nope', CMD).action).toBe('invalid');
  });
});

describe('pickNodeBinary', () => {
  it('prefers a system node over version-manager shims', () => {
    const exists = (p: string) => ['/opt/homebrew/bin/node', '/h/.asdf/installs/nodejs/22.1.0/bin/node'].includes(p);
    expect(pickNodeBinary(['/h/.asdf/shims/node', '/opt/homebrew/bin/node', '/h/.asdf/installs/nodejs/22.1.0/bin/node'], exists)).toBe(
      '/opt/homebrew/bin/node',
    );
  });

  it('falls back to plain node', () => {
    expect(pickNodeBinary(['/nope/node'], () => false)).toBe('node');
  });
});

describe('bridgeCommand', () => {
  it('quotes both paths', () => {
    expect(bridgeCommand('/opt/homebrew/bin/node', '/Users/a b/.claude/usage-monitor/statusline-bridge.js')).toBe(
      '"/opt/homebrew/bin/node" "/Users/a b/.claude/usage-monitor/statusline-bridge.js"',
    );
  });
});
