import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { renderBody } from './render';
import { ViewModel } from './viewModel';

export type ViewMessage = { type: 'ready' | 'refresh' | 'install' | 'open'; id?: string };

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
.ctx { margin: 6px 0 0 16px; font-size: 12px; color: var(--muted); }
.ctx .track { margin-bottom: 3px; }
details { margin: 6px 0 0 16px; }
summary { cursor: pointer; color: var(--muted); font-size: 12px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 6px 0; font-size: 12px; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
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
  if (b) vscode.postMessage({ type: b.dataset.action, id: b.dataset.id });
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
