import * as vscode from 'vscode';
import { formatDuration, formatTokens } from './format';
import { UsageSnapshot, totalTokens } from './types';
import { ViewModel } from './viewModel';

export class UsageStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('claudeUsage.status', vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.name = 'AI Usage & Context Monitor';
    this.item.command = 'claudeUsage.show';
    this.item.text = '$(pulse) AI Usage';
    this.item.show();
  }

  update(vm: ViewModel, snap: UsageSnapshot): void {
    const q = vm.quota;
    const now = snap.takenAt;
    const five = snap.rateLimits?.fiveHour;

    const claudeBusy = vm.sessions.some((s) => s.agent === 'claude' && s.state === 'busy');
    const agyBusy = vm.sessions.some((s) => s.agent === 'antigravity' && s.state === 'busy');

    if (agyBusy && claudeBusy) {
      this.item.text = '$(pulse) Claude & Antigravity active';
    } else if (agyBusy) {
      this.item.text = '$(pulse) Antigravity working';
    } else if (claudeBusy) {
      this.item.text = '$(pulse) Claude working';
    } else if (five) {
      const left = q.tokensLeft ? ` · ~${q.tokensLeft} tok` : '';
      const agyPart = snap.antigravityTotals ? ` · AGY ${formatTokens(totalTokens(snap.antigravityTotals))}` : '';
      this.item.text = `$(pulse) ${q.headline}${left}${agyPart} · ${formatDuration(five.resetsAt * 1000 - now)}`;
    } else if (snap.block || snap.antigravityBlock) {
      const cTok = snap.block ? totalTokens(snap.block.totals) : 0;
      const aTok = snap.antigravityBlock ? totalTokens(snap.antigravityBlock.totals) : 0;
      const agyLabel = aTok > 0 && cTok > 0 ? ` (C: ${formatTokens(cTok)}, A: ${formatTokens(aTok)})` : '';
      const end = snap.block?.end || snap.antigravityBlock?.end || now;
      this.item.text = `$(pulse) ${formatTokens(cTok + aTok)} used${agyLabel} · ${formatDuration(end - now)}`;
    } else {
      this.item.text = '$(pulse) AI idle';
    }

    this.item.backgroundColor =
      q.level === 'crit'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : q.level === 'warn'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`### 🤖 AI Agent Usage & Context Bridge\n\n`);

    md.appendMarkdown(`**Claude**: ${q.headline}\n\n`);
    for (const line of [q.resetLine, q.tokensLine, q.paceLine, q.weekly?.line, q.note?.text]) {
      if (line) md.appendText(`${line}\n\n`);
    }

    if (q.antigravityUsage) {
      md.appendMarkdown(`**Antigravity**: ${q.antigravityUsage.tokens} tokens (${q.antigravityUsage.count} session${q.antigravityUsage.count === 1 ? '' : 's'}${q.antigravityUsage.activeCount > 0 ? `, ${q.antigravityUsage.activeCount} active` : ''})\n\n`);
      if (q.antigravityUsage.resetLine) md.appendText(`${q.antigravityUsage.resetLine}\n\n`);
    }

    if (q.contextBridge) {
      md.appendMarkdown(`---\n\n⚡ **Context Bridge Ready**: Handoff from ${q.contextBridge.sourceAgent === 'claude' ? 'Claude' : 'Antigravity'} to ${q.contextBridge.targetAgent === 'claude' ? 'Claude' : 'Antigravity'}\n\n`);
    }

    const busy = vm.sessions.filter((s) => s.state === 'busy').length;
    const open = vm.sessions.filter((s) => s.state !== 'closed').length;
    md.appendText(`${open} open conversation${open === 1 ? '' : 's'}, ${busy} working now. Click to open usage panel.`);
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
