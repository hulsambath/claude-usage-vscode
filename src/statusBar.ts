import * as vscode from 'vscode';
import { formatDuration, formatTokens } from './format';
import { UsageSnapshot, totalTokens } from './types';
import { ViewModel } from './viewModel';

export class UsageStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('claudeUsage.status', vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.name = 'Claude Usage';
    this.item.command = 'claudeUsage.show';
    this.item.text = '$(pulse) Claude';
    this.item.show();
  }

  update(vm: ViewModel, snap: UsageSnapshot): void {
    const q = vm.quota;
    const now = snap.takenAt;
    const five = snap.rateLimits?.fiveHour;
    if (five) {
      const left = q.tokensLeft ? ` · ~${q.tokensLeft} tok` : '';
      this.item.text = `$(pulse) ${q.headline}${left} · ${formatDuration(five.resetsAt * 1000 - now)}`;
    } else if (snap.block) {
      this.item.text = `$(pulse) ${formatTokens(totalTokens(snap.block.totals))} used · ${formatDuration(snap.block.end - now)}`;
    } else {
      this.item.text = '$(pulse) Claude idle';
    }
    this.item.backgroundColor =
      q.level === 'crit'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : q.level === 'warn'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Claude: ${q.headline}**\n\n`);
    for (const line of [q.resetLine, q.tokensLine, q.paceLine, q.weekly?.line, q.note?.text]) {
      if (line) md.appendText(`${line}\n\n`);
    }
    const busy = vm.sessions.filter((s) => s.state === 'busy').length;
    const open = vm.sessions.filter((s) => s.state !== 'closed').length;
    md.appendText(`${open} open conversation${open === 1 ? '' : 's'}, ${busy} working now. Click for details.`);
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
