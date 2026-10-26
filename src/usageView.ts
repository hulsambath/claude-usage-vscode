import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { renderBody } from './render';
import { ViewModel } from './viewModel';

export type ViewMessage = {
  type:
    | 'ready'
    | 'refresh'
    | 'install'
    | 'open'
    | 'handoff'
    | 'saveHandoff'
    | 'filter'
    | 'dispatch'
    | 'setMode'
    | 'startPipeline'
    | 'advancePipeline'
    | 'pausePipeline'
    | 'resumePipeline'
    | 'cancelPipeline'
    | 'installMcp'
    | 'sendStepToTerminal';
  id?: string;
  filter?: 'all' | 'claude' | 'antigravity';
  mode?: 'monitor' | 'conductor' | 'mesh';
  recipeId?: string;
};

const STYLE = `
:root {
  --fg: var(--vscode-foreground);
  --muted: var(--vscode-descriptionForeground);
  --line: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35)));
  --track: var(--vscode-input-background, rgba(128,128,128,.18));
  --ok: var(--vscode-charts-green, #3fa66b);
  --warn: var(--vscode-charts-yellow, #d7a40b);
  --crit: var(--vscode-charts-red, #e5534b);
  --busy: var(--vscode-charts-blue, #4c8fe0);
  --link: var(--vscode-textLink-foreground);
}
body { margin: 0; padding: 14px 14px 24px; color: var(--fg); background: transparent;
  font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.45; }
p { margin: 0; }
h1, h2 { margin: 0; font-weight: 600; }
.track { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
.track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.track.time { height: 3px; margin-top: 5px; }
.track.time span { background: var(--muted); opacity: .75; }
.track.time.solo { height: 6px; }
.track.thin { height: 4px; }

.mode-tabs { display: flex; gap: 4px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.mode-btn { flex: 1; font-size: 11px; padding: 5px 8px; border-radius: 4px; background: var(--track); color: var(--muted); border: 1px solid transparent; cursor: pointer; text-align: center; }
.mode-btn:hover { color: var(--fg); }
.mode-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }

.conductor-panel { margin-top: 4px; }
.pipeline-active { padding: 12px; border-radius: 6px; background: rgba(76, 143, 224, 0.08); border: 1px solid rgba(76, 143, 224, 0.3); margin-bottom: 14px; }
.pipe-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pipe-status { font-size: 10px; text-transform: uppercase; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.pipe-status.running { background: rgba(76, 143, 224, 0.2); color: #4c8fe0; }
.pipe-status.paused { background: rgba(215, 164, 11, 0.2); color: #d7a40b; }
.pipe-status.completed { background: rgba(63, 166, 107, 0.2); color: #3fa66b; }
.step-list { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
.step-card { padding: 8px 10px; border-radius: 4px; background: var(--track); border: 1px solid var(--line); border-left: 3px solid transparent; font-size: 12px; }
.step-card.step-running { border-left-color: #4c8fe0; background: rgba(76, 143, 224, 0.12); }
.step-card.step-completed { border-left-color: #3fa66b; opacity: .85; }
.step-card.step-paused { border-left-color: #d7a40b; }
.step-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.step-title { font-weight: 600; font-size: 12px; }
.step-instruction { color: var(--muted); font-size: 11px; margin-top: 3px; }
.pipe-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }

.recipe-list { display: flex; flex-direction: column; gap: 8px; }
.recipe-card { padding: 10px 12px; border-radius: 6px; background: var(--track); border: 1px solid var(--line); }
.recipe-card h3 { font-size: 12px; margin: 0 0 4px; }
.recipe-card p { font-size: 11px; color: var(--muted); margin-bottom: 8px; }

.mesh-panel { margin-top: 4px; }
.mesh-status-card { padding: 10px 12px; border-radius: 6px; background: rgba(142, 68, 173, 0.08); border: 1px solid rgba(142, 68, 173, 0.25); margin-bottom: 12px; }
.mesh-peers { display: flex; gap: 8px; margin: 8px 0; }
.peer-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--track); }
.peer-indicator { width: 6px; height: 6px; border-radius: 50%; background: #3fa66b; }
.mesh-log { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.mesh-msg { padding: 8px; border-radius: 4px; background: var(--track); border: 1px solid var(--line); font-size: 11px; }
.mesh-msg-head { display: flex; justify-content: space-between; color: var(--muted); font-size: 10px; margin-bottom: 2px; }

.quota, .level-ok { --accent: var(--ok); }
.level-warn { --accent: var(--warn); }
.level-crit { --accent: var(--crit); }
.head { display: flex; align-items: baseline; gap: 8px; }
.quota h1 { font-size: 26px; line-height: 1.15; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.level-warn h1, .level-crit h1 { color: var(--accent); }
.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 0 6px; }
.reset { color: var(--muted); margin-top: 2px; }
.gauge { margin: 12px 0 10px; }
.legend { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tokens { font-variant-numeric: tabular-nums; }
.pace { color: var(--muted); margin-top: 4px; }
.weekly { margin-top: 14px; color: var(--muted); font-size: 12px; }
.weekly .track { margin-bottom: 4px; }
.note { margin-top: 14px; padding: 8px 10px; border-radius: 4px; background: var(--vscode-textBlockQuote-background, var(--track)); }
.note button { margin-top: 8px; }

.badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center; }
.badge.claude { background: rgba(215, 120, 50, 0.15); color: #e0884c; border: 1px solid rgba(215, 120, 50, 0.3); }
.badge.antigravity { background: rgba(76, 143, 224, 0.15); color: #4c8fe0; border: 1px solid rgba(76, 143, 224, 0.3); }

.dual-graphs { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.agent-graph-card { padding: 12px 12px 10px; border-radius: 6px; background: var(--vscode-textBlockQuote-background, var(--track)); border: 1px solid var(--line); border-left: 3px solid transparent; }
.agent-graph-card.claude { border-left-color: #e0884c; --accent: var(--ok); }
.agent-graph-card.claude.level-warn { --accent: var(--warn); }
.agent-graph-card.claude.level-crit { --accent: var(--crit); }
.agent-graph-card.antigravity { border-left-color: #4c8fe0; --accent: #4c8fe0; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
.card-headline { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.agent-graph-card .gauge { margin: 8px 0 6px; }
.agent-graph-card .weekly { margin-top: 6px; }
.agent-graph-card .reset { font-size: 11px; color: var(--muted); margin-top: 4px; }
.agent-graph-card .tokens { font-size: 12px; color: var(--muted); margin-top: 4px; }
.agent-graph-card .pace { font-size: 12px; color: var(--muted); margin-top: 4px; }
.agent-graph-card .ctx-summary { font-size: 11px; color: var(--muted); margin: 4px 0 2px; }
.agent-graph-card .ctx-tag { font-weight: 500; }
.card-action { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.btn-card-action { font-size: 11px; padding: 4px 8px; border-radius: 4px; background: var(--track); color: var(--fg); border: 1px solid var(--line); width: 100%; text-align: center; }
.btn-card-action:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }

.bridge-card { margin-top: 14px; padding: 10px 12px; border-radius: 6px; background: rgba(76, 143, 224, 0.08); border: 1px solid rgba(76, 143, 224, 0.25); }
.bridge-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
.bridge-badge { color: var(--fg); }
.bridge-target { color: var(--link); }
.bridge-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.bridge-opt { padding: 8px 10px; border-radius: 4px; background: var(--track); border: 1px solid var(--line); }
.bridge-opt-title { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px; }
.bridge-arrow { color: var(--muted); font-size: 11px; }
.bridge-desc { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.bridge-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.btn-primary { font-size: 11px; padding: 3px 8px; border-radius: 3px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-subtle { font-size: 11px; padding: 3px 8px; border-radius: 3px; background: var(--track); color: var(--fg); border: 1px solid var(--line); }
.btn-subtle:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }

.dispatcher-card { margin-top: 10px; padding: 10px 12px; border-radius: 6px; background: rgba(142, 68, 173, 0.08); border: 1px solid rgba(142, 68, 173, 0.25); }
.disp-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.disp-badge { color: var(--fg); }
.disp-count { color: var(--muted); font-size: 11px; }
.disp-desc { font-size: 12px; color: var(--muted); margin-bottom: 8px; }

.conv-actions { display: flex; gap: 6px; margin: 6px 0 2px 16px; flex-wrap: wrap; }
.btn-quick { font-size: 11px; padding: 2px 6px; border-radius: 3px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; }
.btn-quick:hover { background: var(--vscode-button-hoverBackground); }
.btn-quick.subtle { background: var(--track); color: var(--fg); border: 1px solid var(--line); }
.btn-quick.subtle:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }

.filter-tabs { display: flex; gap: 4px; margin: 10px 0 6px; overflow-x: auto; }
.tab-btn { font-size: 11px; padding: 3px 8px; border-radius: 12px; background: var(--track); color: var(--muted); border: 1px solid transparent; cursor: pointer; }
.tab-btn:hover { color: var(--fg); }
.tab-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

.list-head { display: flex; justify-content: space-between; align-items: baseline;
  margin: 22px 0 4px; padding-top: 14px; border-top: 1px solid var(--line); }
.list-head h2 { font-size: 12px; color: var(--muted); }
.conv { --accent: var(--busy); margin: 0 -14px; padding: 10px 14px 10px 12px; border-left: 2px solid transparent; }
.conv + .conv { border-top: 1px solid var(--line); }
.conv.state-busy { border-left-color: var(--busy); }
.conv.elsewhere { opacity: .72; }
.row { display: flex; align-items: center; gap: 8px; }
.row h2 { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state-closed .row h2 { font-weight: 400; color: var(--muted); }
.tok { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; }
.state-busy .dot { background: var(--busy); animation: pulse 1.6s ease-in-out infinite; }
.state-idle .dot { border: 1.5px solid var(--ok); }
.state-closed .dot { border: 1.5px solid var(--line); }
.title { margin: 2px 0 0 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { margin-left: 16px; color: var(--muted); font-size: 12px; }
.files-tag { font-size: 11px; color: var(--muted); }
.ctx { margin: 6px 0 0 16px; font-size: 12px; color: var(--muted); }
.ctx .track { margin-bottom: 3px; }
details { margin: 6px 0 0 16px; }
summary { cursor: pointer; color: var(--muted); font-size: 12px; }
dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 6px 0; font-size: 12px; }
dt { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.session-actions { display: flex; gap: 10px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.empty { color: var(--muted); padding: 8px 0; }

button { font: inherit; font-size: 12px; cursor: pointer; border: 0; border-radius: 2px; padding: 4px 10px;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
button.link { padding: 0; background: none; color: var(--link); }
button.link:hover { text-decoration: underline; background: none; }
:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .state-busy .dot { animation: none; } }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
const open = new Set((vscode.getState() || {}).open || []);
window.addEventListener('message', (e) => {
  if (e.data.type !== 'render') return;
  root.innerHTML = e.data.html;
  root.querySelectorAll('details[data-id]').forEach((d) => {
    if (open.has(d.dataset.id)) d.open = true;
    d.addEventListener('toggle', () => {
      d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id);
      vscode.setState({ open: [...open] });
    });
  });
});
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) vscode.postMessage({
    type: b.dataset.action,
    id: b.dataset.id,
    filter: b.dataset.filter,
    mode: b.dataset.mode,
    recipeId: b.dataset.recipeId
  });
});
vscode.postMessage({ type: 'ready' });
`;

export class UsageViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private html = '<p class="empty">Reading ~/.claude…</p>';

  constructor(
    readonly id: string,
    private readonly onMessage: (m: ViewMessage) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const nonce = randomBytes(16).toString('base64');
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style></head>
<body><main id="root"></main><script nonce="${nonce}">${SCRIPT}</script></body></html>`;
    view.webview.onDidReceiveMessage((m: ViewMessage) => {
      if (m.type === 'ready') this.post();
      else this.onMessage(m);
    });
    view.onDidChangeVisibility(() => view.visible && this.post());
    view.onDidDispose(() => (this.view = undefined));
  }

  update(vm: ViewModel): void {
    this.html = renderBody(vm);
    this.post();
  }

  private post(): void {
    if (this.view?.visible) void this.view.webview.postMessage({ type: 'render', html: this.html });
  }
}
