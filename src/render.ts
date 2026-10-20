import { QuotaVM, SessionVM, ViewModel } from './viewModel';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pct = (n: number | undefined): number => Math.min(100, Math.max(0, Math.round(n ?? 0)));

function renderQuota(q: QuotaVM): string {
  const gauge =
    q.usedPct !== undefined
      ? `<div class="gauge" role="img" aria-label="${pct(q.usedPct)}% of the 5-hour quota used, ${pct(q.elapsedPct)}% of the window elapsed">
      <div class="track use"><span style="width:${pct(q.usedPct)}%"></span></div>
      <div class="track time"><span style="width:${pct(q.elapsedPct)}%"></span></div>
      <div class="legend"><span>Quota used ${pct(q.usedPct)}%</span><span>Time passed ${pct(q.elapsedPct)}%</span></div>
    </div>`
      : q.elapsedPct !== undefined
        ? `<div class="gauge" role="img" aria-label="${pct(q.elapsedPct)}% of the window elapsed">
      <div class="track time solo"><span style="width:${pct(q.elapsedPct)}%"></span></div>
    </div>`
        : '';
  const line = (cls: string, text?: string) => (text ? `<p class="${cls}">${esc(text)}</p>` : '');
  const weekly = q.weekly
    ? `<div class="weekly level-${q.weekly.level}">
      <div class="track thin"><span style="width:${pct(q.weekly.usedPct)}%"></span></div>
      <p>${esc(q.weekly.line)}</p>
    </div>`
    : '';
  const note = q.note
    ? `<div class="note"><p>${esc(q.note.text)}</p>${
        q.note.action === 'install' ? '<button data-action="install">Install status line bridge</button>' : ''
      }</div>`
    : '';
  return `<section class="quota level-${q.level}" aria-label="5-hour quota">
    <div class="head"><h1>${esc(q.headline)}</h1>${q.state === 'local' ? '<span class="tag">estimate</span>' : ''}</div>
    ${line('reset', q.resetLine)}
    ${gauge}
    ${line('tokens', q.tokensLine)}
    ${line('pace', q.paceLine)}
    ${weekly}
    ${note}
  </section>`;
}

function renderSession(s: SessionVM): string {
  const ctx = s.context
    ? `<div class="ctx"><div class="track thin"><span style="width:${pct(s.context.usedPct)}%"></span></div><span>${esc(s.context.line)}</span></div>`
    : '';
  const rows = s.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const open = s.canOpen ? `<button class="link" data-action="open" data-id="${esc(s.id)}">Open transcript</button>` : '';
  const title = s.title && s.title !== s.name ? `<p class="title">${esc(s.title)}</p>` : '';
  return `<article class="conv state-${s.state}${s.inWorkspace ? '' : ' elsewhere'}">
    <div class="row"><span class="dot" aria-hidden="true"></span><h2>${esc(s.name)}</h2><span class="tok" title="Tokens used in this conversation">${esc(s.tokens)}</span></div>
    ${title}
    <p class="meta">${esc(s.meta)}</p>
    ${ctx}
    <details data-id="${esc(s.id)}"><summary>Token breakdown</summary><dl>${rows}</dl>${open}</details>
  </article>`;
}

export function renderBody(vm: ViewModel): string {
  const list = vm.sessions.length
    ? vm.sessions.map(renderSession).join('')
    : '<p class="empty">No Claude Code conversations in the last 5 hours.</p>';
  return `${renderQuota(vm.quota)}
  <div class="list-head"><h2>Conversations</h2><button class="link" data-action="refresh">Refresh</button></div>
  ${list}`;
}
