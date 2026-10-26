import { FSWatcher, existsSync, readdirSync, watch } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { AntigravityCollector } from './antigravityCollector';
import { antigravityPaths, defaultAntigravityRoot } from './antigravityPaths';
import { Collector } from './collector';
import { focusFirst } from './focus';
import { generateDispatchMessage, generateHandoffPrompt, saveHandoffFile } from './handoff';
import { defaultClaudeRoot, paths } from './paths';
import { bridgeCommand, pickNodeBinary, planStatusLineInstall } from './settingsPlan';
import { UsageStatusBar } from './statusBar';
import { AgentType, SessionView, UsageSnapshot } from './types';
import { UsageViewProvider, ViewMessage } from './usageView';
import { buildViewModel } from './viewModel';

export function activate(context: vscode.ExtensionContext): void {
  const root = defaultClaudeRoot();
  const p = paths(root);
  const agyRoot = defaultAntigravityRoot();
  const agyP = antigravityPaths(agyRoot);
  const agyCollector = existsSync(agyRoot) ? new AntigravityCollector(agyRoot) : undefined;
  const collector = new Collector(root, undefined, agyCollector);
  const statusBar = new UsageStatusBar();
  const log = vscode.window.createOutputChannel('AI Usage & Context Monitor');
  let latest: UsageSnapshot | undefined;
  let currentFilter: AgentType | 'all' = 'all';

  const findSession = async (sessionId?: string): Promise<SessionView | undefined> => {
    if (!latest || latest.sessions.length === 0) return undefined;
    if (sessionId) {
      return latest.sessions.find((s) => s.sessionId === sessionId);
    }
    // If not provided, prompt user or pick most recent
    if (latest.sessions.length === 1) return latest.sessions[0];
    const items = latest.sessions.map((s) => ({
      label: `${s.agent === 'claude' ? '🟣 Claude' : '🔵 Antigravity'}: ${s.live?.name || s.title || s.sessionId.slice(0, 8)}`,
      description: s.title && s.title !== s.live?.name ? s.title : s.live?.cwd || s.usage?.cwd || '',
      detail: s.filesTouched && s.filesTouched.length > 0 ? `Files: ${s.filesTouched.join(', ')}` : undefined,
      session: s,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a conversation to generate context handoff for',
    });
    return picked?.session;
  };

  const copyHandoff = async (sessionId?: string) => {
    const session = await findSession(sessionId);
    if (!session) {
      void vscode.window.showWarningMessage('No active or recent AI conversation found to hand off.');
      return;
    }
    const targetAgent: AgentType = session.agent === 'claude' ? 'antigravity' : 'claude';
    const targetName = targetAgent === 'claude' ? 'Claude Code' : 'Antigravity';
    const prompt = generateHandoffPrompt({ sourceSession: session, targetAgent });
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      `Context handoff copied to clipboard! Paste it into ${targetName} to continue seamlessly.`,
    );
  };

  const copyHandoffTo = async (targetAgent: AgentType) => {
    if (!latest || latest.sessions.length === 0) {
      void vscode.window.showWarningMessage('No active or recent AI conversation found to hand off.');
      return;
    }
    const sourceAgent: AgentType = targetAgent === 'claude' ? 'antigravity' : 'claude';
    const sourceName = sourceAgent === 'claude' ? 'Claude Code' : 'Antigravity';
    const targetName = targetAgent === 'claude' ? 'Claude Code' : 'Antigravity';

    const matchingSessions = latest.sessions.filter((s) => (s.agent || 'claude') === sourceAgent);
    let session: SessionView | undefined;
    if (matchingSessions.length === 1) {
      session = matchingSessions[0];
    } else if (matchingSessions.length > 1) {
      const items = matchingSessions.map((s) => ({
        label: `${s.agent === 'claude' ? '🟣 Claude' : '🔵 Antigravity'}: ${s.live?.name || s.title || s.sessionId.slice(0, 8)}`,
        description: s.title && s.title !== s.live?.name ? s.title : s.live?.cwd || s.usage?.cwd || '',
        detail: s.filesTouched && s.filesTouched.length > 0 ? `Files: ${s.filesTouched.join(', ')}` : undefined,
        session: s,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Select ${sourceName} session to hand off to ${targetName}`,
      });
      session = picked?.session;
    } else {
      session = await findSession();
    }
    if (!session) return;
    const prompt = generateHandoffPrompt({ sourceSession: session, targetAgent });
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      `Context handoff copied to clipboard! Paste it into ${targetName} to continue seamlessly.`,
    );
  };

  const saveHandoff = async (sessionId?: string) => {
    const session = await findSession(sessionId);
    if (!session) {
      void vscode.window.showWarningMessage('No active or recent AI conversation found to hand off.');
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    const wsFolder = folders && folders.length > 0 ? folders[0].uri.fsPath : session.live?.cwd || session.usage?.cwd || process.cwd();
    const prompt = generateHandoffPrompt({ sourceSession: session });
    const filePath = await saveHandoffFile(wsFolder, prompt);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(`Saved context bridge to ${filePath} and opened in editor.`);
  };

  const findTerminalForSession = async (session: SessionView): Promise<vscode.Terminal | undefined> => {
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) return undefined;

    if (session.live?.pid) {
      for (const t of terminals) {
        const pid = await t.processId;
        if (pid === session.live.pid) return t;
      }
    }

    const targetId = session.sessionId.toLowerCase();
    const sessionName = (session.live?.name || session.title || '').toLowerCase();

    for (const t of terminals) {
      const tName = t.name.toLowerCase();
      if (sessionName && tName.includes(sessionName)) return t;
      if (tName.includes(targetId.slice(0, 8))) return t;
    }

    return undefined;
  };

  const dispatchSessionMessage = async (sourceId?: string) => {
    if (!latest || latest.sessions.length === 0) {
      void vscode.window.showWarningMessage('No active AI conversations found.');
      return;
    }

    let sourceSession: SessionView | undefined;
    if (sourceId) {
      sourceSession = latest.sessions.find((s) => s.sessionId === sourceId);
    }
    if (!sourceSession) {
      const items = latest.sessions.map((s) => ({
        label: `${s.agent === 'claude' ? '🟣 Claude' : '🔵 Antigravity'}: ${s.live?.name || s.title || s.sessionId.slice(0, 8)}`,
        description: s.title && s.title !== s.live?.name ? s.title : s.live?.cwd || s.usage?.cwd || '',
        session: s,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Step 1/3: Select Sender Session',
        placeHolder: 'Which AI conversation is sending the message?',
      });
      if (!picked) return;
      sourceSession = picked.session;
    }

    const otherSessions = latest.sessions.filter((s) => s.sessionId !== sourceSession!.sessionId);
    interface TargetOption extends vscode.QuickPickItem {
      session?: SessionView;
      targetType: 'session' | 'terminal' | 'clipboard';
    }
    const targetItems: TargetOption[] = otherSessions.map((s) => ({
      label: `${s.agent === 'claude' ? '🟣 Claude' : '🔵 Antigravity'}: ${s.live?.name || s.title || s.sessionId.slice(0, 8)}`,
      description: s.title && s.title !== s.live?.name ? s.title : s.live?.cwd || s.usage?.cwd || '',
      session: s,
      targetType: 'session' as const,
    }));

    targetItems.push(
      { label: '📺 Active VS Code Terminal', description: 'Paste directly into currently active terminal', targetType: 'terminal' },
      { label: '📋 Clipboard Only', description: 'Copy formatted prompt to paste anywhere', targetType: 'clipboard' },
    );

    const pickedTarget = await vscode.window.showQuickPick(targetItems, {
      title: 'Step 2/3: Select Recipient Session',
      placeHolder: 'Which conversation or terminal should receive the message?',
    });
    if (!pickedTarget) return;

    const sourceAgentName = sourceSession.agent === 'claude' ? 'Claude Code' : 'Antigravity';
    const targetAgentName = pickedTarget.session
      ? pickedTarget.session.agent === 'claude' ? 'Claude Code' : 'Antigravity'
      : 'Target';

    const input = await vscode.window.showInputBox({
      title: `Step 3/3: Message from ${sourceAgentName} to ${targetAgentName}`,
      prompt: 'Enter instructions/questions for the other session (or press Enter to forward findings snapshot):',
      placeHolder: 'e.g. I updated the backend models. Please implement the frontend widgets and unit tests.',
    });
    if (input === undefined) return;

    const formatted = generateDispatchMessage({
      sourceSession,
      targetSession: pickedTarget.session,
      customMessage: input || undefined,
      attachContext: true,
    });

    await vscode.env.clipboard.writeText(formatted);

    if (pickedTarget.targetType === 'terminal' || (pickedTarget.targetType === 'session' && pickedTarget.session)) {
      const term =
        pickedTarget.targetType === 'terminal'
          ? vscode.window.activeTerminal
          : await findTerminalForSession(pickedTarget.session!);

      if (term) {
        term.sendText(formatted, false);
        term.show(true);
        void vscode.window.showInformationMessage(
          `Message delivered to ${pickedTarget.label} terminal & copied to clipboard! Press Enter in terminal to run.`,
        );
        return;
      }
    }

    void vscode.window.showInformationMessage(
      `Message formatted & copied to clipboard! Paste it into ${pickedTarget.label} to continue seamlessly.`,
    );
  };

  const onMessage = (m: ViewMessage) => {
    if (m.type === 'refresh') void refresh();
    if (m.type === 'install') void vscode.commands.executeCommand('claudeUsage.installBridge');
    if (m.type === 'open') void vscode.commands.executeCommand('claudeUsage.openTranscript', m.id);
    if (m.type === 'handoff') void copyHandoff(m.id);
    if (m.type === 'saveHandoff') void saveHandoff(m.id);
    if (m.type === 'dispatch') void dispatchSessionMessage(m.id);
    if (m.type === 'filter') {
      currentFilter = m.filter || 'all';
      void refresh();
    }
  };

  // The same usage view lives in the left activity bar and the right secondary side bar.
  const views = ['claudeUsage.view', 'claudeUsage.sideView'].map((id) => new UsageViewProvider(id, onMessage));
  context.subscriptions.push(statusBar, log, ...views.map((v) => vscode.window.registerWebviewViewProvider(v.id, v)));

  const config = () => vscode.workspace.getConfiguration('claudeUsage');
  let running = false;
  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const snap = await collector.collect(folders, config().get<'workspace' | 'all'>('scope', 'workspace'), Date.now());
      latest = snap;
      const vm = buildViewModel(snap, config().get<number>('warnAt', 80), currentFilter);
      for (const v of views) v.update(vm);
      statusBar.update(vm, snap);
    } catch (e) {
      log.appendLine(`[${new Date().toISOString()}] refresh failed: ${e instanceof Error ? e.stack : String(e)}`);
    } finally {
      running = false;
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, Math.max(2, config().get<number>('refreshSeconds', 10)) * 1000);
  };
  schedule();
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  // Watchers for fast reactions
  let watcher: FSWatcher | undefined;
  let agyWatcher: FSWatcher | undefined;
  let debounce: NodeJS.Timeout | undefined;

  const ensureWatchers = () => {
    if (!watcher && existsSync(p.bridgeSnapshots)) {
      try {
        watcher = watch(p.bridgeSnapshots, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(refresh, 500);
        });
      } catch (e) {
        log.appendLine(`claude watch failed: ${String(e)}`);
      }
    }
    if (!agyWatcher && existsSync(agyP.presence)) {
      try {
        agyWatcher = watch(agyP.presence, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(refresh, 500);
        });
      } catch (e) {
        log.appendLine(`antigravity watch failed: ${String(e)}`);
      }
    }
  };
  ensureWatchers();
  const watchRetry = setInterval(ensureWatchers, 60_000);
  context.subscriptions.push({
    dispose: () => {
      watcher?.close();
      agyWatcher?.close();
      clearInterval(watchRetry);
      if (debounce) clearTimeout(debounce);
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudeUsage')) return;
      schedule();
      void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
    vscode.commands.registerCommand('claudeUsage.refresh', refresh),
    vscode.commands.registerCommand('claudeUsage.copyHandoff', (id?: string) => copyHandoff(id)),
    vscode.commands.registerCommand('claudeUsage.dispatch', (id?: string) => dispatchSessionMessage(id)),
    vscode.commands.registerCommand('claudeUsage.handoffToClaude', () => copyHandoffTo('claude')),
    vscode.commands.registerCommand('claudeUsage.handoffToAntigravity', () => copyHandoffTo('antigravity')),
    vscode.commands.registerCommand('claudeUsage.saveHandoff', (id?: string) => saveHandoff(id)),
    vscode.commands.registerCommand('claudeUsage.show', async () => {
      if (await focusFirst(['claudeUsage.sideView', 'claudeUsage.view'], (c) => vscode.commands.executeCommand(c))) return;
      const choice = await vscode.window.showWarningMessage(
        'Usage panel was updated, but this window still has the old layout. Reload the window to show the usage panel.',
        'Reload Window',
      );
      if (choice) await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
    vscode.commands.registerCommand('claudeUsage.openTranscript', async (sessionId?: string) => {
      const path = latest?.sessions.find((s) => s.sessionId === sessionId)?.transcriptPath;
      if (path) await vscode.window.showTextDocument(vscode.Uri.file(path), { preview: true });
    }),
    vscode.commands.registerCommand('claudeUsage.installBridge', async () => {
      await installBridge(context, p, log);
      ensureWatchers();
      await refresh();
    }),
  );

  void refresh();
}

function nodeCandidates(): string[] {
  const asdf = join(homedir(), '.asdf', 'installs', 'nodejs');
  let versions: string[] = [];
  try {
    versions = readdirSync(asdf).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    // no asdf
  }
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', ...versions.map((v) => join(asdf, v, 'bin', 'node'))];
}

async function installBridge(context: vscode.ExtensionContext, p: ReturnType<typeof paths>, log: vscode.OutputChannel) {
  const command = bridgeCommand(pickNodeBinary(nodeCandidates(), existsSync), p.installedBridge);
  let current: string | undefined;
  try {
    current = await readFile(p.settings, 'utf8');
  } catch {
    current = undefined;
  }

  // Refresh the script copy even when already installed, so extension updates reach it.
  await mkdir(p.monitor, { recursive: true });
  await copyFile(context.asAbsolutePath(join('bridge', 'statusline-bridge.js')), p.installedBridge);

  const plan = planStatusLineInstall(current, command);
  switch (plan.action) {
    case 'already':
      void vscode.window.showInformationMessage('Claude Usage: the status line bridge is already installed (script refreshed).');
      return;
    case 'invalid':
      void vscode.window.showErrorMessage(`Claude Usage: ${p.settings} is not valid JSON, so it was left untouched.`);
      return;
    case 'conflict':
      log.appendLine(`Existing statusLine: ${plan.existing}\nBridge command: ${command}`);
      log.show(true);
      void vscode.window.showWarningMessage(
        'Claude Usage: you already have a status line command, so it was not replaced. To enable the 5h quota, pipe the same stdin into the bridge from your script (both commands are in the "Claude Usage" output).',
      );
      return;
    case 'install': {
      const ok = await vscode.window.showInformationMessage(
        `Set Claude Code's statusLine to the usage bridge?\n\n${command}\n\nIt shows "5h 42% · ctx 31%" in Claude Code and saves the quota for this extension. ${p.settings} is backed up first.`,
        { modal: true },
        'Install',
      );
      if (ok !== 'Install') return;
      if (current !== undefined) await writeFile(`${p.settings}.bak-claude-usage`, current);
      await writeFile(p.settings, plan.text);
      void vscode.window.showInformationMessage('Claude Usage: bridge installed. The quota appears after the next Claude response.');
    }
  }
}

export function deactivate(): void {}
