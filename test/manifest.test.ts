import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('package.json', () => {
  // VS Code reads a view container icon as a file path; `$(codicon)` syntax
  // resolves to a missing file and leaves the activity bar button invisible.
  it('points every view container at an icon file that exists', () => {
    const { activitybar, secondarySidebar } = manifest.contributes.viewsContainers;
    for (const c of [...activitybar, ...secondarySidebar]) {
      expect(c.icon).not.toMatch(/^\$\(/);
      expect(existsSync(join(root, c.icon))).toBe(true);
    }
  });

  it('puts a usage view in both the left activity bar and the right secondary side bar', () => {
    const { viewsContainers, views } = manifest.contributes;
    expect(viewsContainers.secondarySidebar).toHaveLength(1);
    for (const c of [viewsContainers.activitybar[0], viewsContainers.secondarySidebar[0]]) {
      expect(views[c.id]).toEqual([expect.objectContaining({ type: 'webview' })]);
    }
    expect(views[viewsContainers.secondarySidebar[0].id][0].id).toBe('claudeUsage.sideView');
  });

  it('ships the icon and the bridge in the package', () => {
    const ignored = readFileSync(join(root, '.vscodeignore'), 'utf8');
    expect(ignored).not.toMatch(/^media/m);
    expect(ignored).not.toMatch(/^bridge/m);
  });

  it('offers a palette command to open the view', () => {
    expect(manifest.contributes.commands.map((c: { command: string }) => c.command)).toContain('claudeUsage.show');
  });
});
