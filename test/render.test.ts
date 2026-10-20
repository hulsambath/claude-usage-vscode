import { describe, expect, it } from 'vitest';
import { renderBody } from '../src/render';
import { QuotaVM, SessionVM, ViewModel } from '../src/viewModel';

const quota: QuotaVM = {
  state: 'official',
  headline: '54% left',
  usedPct: 46,
  elapsedPct: 35,
  level: 'warn',
  resetLine: 'Resets at 04:50, in 3h 14m',
  tokensLine: 'About 2.1M tokens left of roughly 3.9M',
  paceLine: "At this pace you'll finish this window with about 20% to spare.",
  weekly: { usedPct: 16, line: '16% of this week used, resets in 2d 3h', level: 'ok' },
};

const session: SessionVM = {
  id: 'abc-1',
  name: 'balling-3',
  title: 'Fix <script>alert(1)</script> & co',
  state: 'busy',
  tokens: '2.5M',
  meta: 'Working now in balling',
  inWorkspace: true,
  canOpen: true,
  context: { usedPct: 30, line: '140.0k of 200.0k context tokens left' },
  details: [['Output', '2.5M']],
};

const vm = (over: Partial<ViewModel> = {}): ViewModel => ({ quota, sessions: [session], ...over });

describe('renderBody', () => {
  it('draws both gauge tracks with accessible text', () => {
    const html = renderBody(vm());
    expect(html).toContain('class="quota level-warn"');
    expect(html).toContain('style="width:46%"');
    expect(html).toContain('style="width:35%"');
    expect(html).toContain('aria-label="46% of the 5-hour quota used, 35% of the window elapsed"');
    expect(html).toContain('54% left');
    expect(html).toContain('About 2.1M tokens left of roughly 3.9M');
  });

  it('escapes conversation text', () => {
    const html = renderBody(vm());
    expect(html).not.toContain('<script>');
    expect(html).toContain('Fix &lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });

  it('keys each conversation so expanded details survive a refresh', () => {
    const html = renderBody(vm());
    expect(html).toContain('<details data-id="abc-1">');
    expect(html).toContain('data-action="open" data-id="abc-1"');
  });

  it('shows the install action only when asked for', () => {
    expect(renderBody(vm())).not.toContain('data-action="install"');
    const html = renderBody(vm({ quota: { state: 'none', headline: 'No usage in the last 5 hours', level: 'ok', note: { text: 'Install it.', action: 'install' } } }));
    expect(html).toContain('data-action="install"');
    expect(html).not.toContain('class="gauge"');
  });

  it('invites a first conversation when the list is empty', () => {
    expect(renderBody(vm({ sessions: [] }))).toContain('No Claude Code conversations in the last 5 hours.');
  });

  it('clamps gauge widths', () => {
    expect(renderBody(vm({ quota: { ...quota, usedPct: 140, elapsedPct: -3 } }))).toContain('style="width:100%"');
    expect(renderBody(vm({ quota: { ...quota, usedPct: 140, elapsedPct: -3 } }))).toContain('style="width:0%"');
  });
});
