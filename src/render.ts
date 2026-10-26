import { AgentCardVM, QuotaVM, SessionVM, ViewModel } from './viewModel';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pct = (n: number | undefined): number => Math.min(100, Math.max(0, Math.round(n ?? 0)));

function renderCardGauge(card: AgentCardVM): string {
  const g = card.gauge;
  if (!g) return '';
  const tracks: string[] = [];
  if (g.usedPct !== undefined) {
    tracks.push(`<div class="track use"><span style="width:${pct(g.usedPct)}%"></span></div>`);
  }
  if (g.elapsedPct !== undefined) {
    tracks.push(`<div class="track time${g.usedPct === undefined ? ' solo' : ''}"><span style="width:${pct(g.elapsedPct)}%"></span></div>`);
  }
  const legendParts: string[] = [];
  if (g.legendUsed) legendParts.push(`<span>${esc(g.legendUsed)}</span>`);
  if (g.legendTime) legendParts.push(`<span>${esc(g.legendTime)}</span>`);
  const legend = legendParts.length > 0 ? `<div class="legend">${legendParts.join('')}</div>` : '';

  return `<div class="gauge" role="img" aria-label="${esc(g.ariaLabel || '')}">
    ${tracks.join('')}
    ${legend}
  </div>`;
}

function renderClaudeCard(c: AgentCardVM): string {
  const line = (cls: string, text?: string) => (text ? `<p class="${cls}">${esc(text)}</p>` : '');
  const weekly = c.weekly
    ? `<div class="weekly level-${c.weekly.level}">
      <div class="track thin"><span style="width:${pct(c.weekly.usedPct)}%"></span></div>
      <p>${esc(c.weekly.line)}</p>
    </div>`
    : '';
  const note = c.note
    ? `<div class="note"><p>${esc(c.note.text)}</p>${
        c.note.action === 'install' ? '<button data-action="install">Install status line bridge</button>' : ''
      }</div>`
    : '';

  return `<div class="agent-graph-card claude level-${c.level}">
    <div class="card-head">
      <span class="badge claude">Claude Code</span>
      <span class="card-headline">${esc(c.headline)}</span>
    </div>
    ${renderCardGauge(c)}
    ${line('tokens', c.tokensLine)}
    ${line('pace', c.paceLine)}
    ${weekly}
    ${line('reset', c.resetLine)}
    ${note}
    ${
      c.handoff
        ? `<div class="card-action"><button class="btn-card-action" data-action="handoff" data-id="${esc(c.handoff.sessionId)}" title="Handoff this Claude session to Antigravity">⚡ Handoff to Antigravity</button></div>`
        : ''
    }
  </div>`;
}

function renderAntigravityCard(a: AgentCardVM): string {
  const line = (cls: string, text?: string) => (text ? `<p class="${cls}">${esc(text)}</p>` : '');
  const ctx = a.contextTrack
    ? `<div class="ctx-summary">
        <span class="ctx-tag">Context window:</span> <span>${esc(a.contextTrack.line)}</span>
      </div>`
    : '';

  return `<div class="agent-graph-card antigravity level-${a.level}">
    <div class="card-head">
      <span class="badge antigravity">Antigravity</span>
      <span class="card-headline">${esc(a.headline)}</span>
    </div>
    ${renderCardGauge(a)}
    ${ctx}
    ${line('tokens', a.tokensLine)}
    ${line('reset', a.resetLine)}
    ${
      a.handoff
        ? `<div class="card-action"><button class="btn-card-action" data-action="handoff" data-id="${esc(a.handoff.sessionId)}" title="Handoff this Antigravity session to Claude Code">⚡ Handoff to Claude</button></div>`
        : ''
    }
  </div>`;
}

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

  let bridgeCard = '';
  const toClaude = q.contextBridges?.toClaude;
  const toAntigravity = q.contextBridges?.toAntigravity;

  if (toClaude && toAntigravity) {
    bridgeCard = `<div class="bridge-card" role="region" aria-label="Context Bridge">
      <div class="bridge-head">
        <span class="bridge-badge">⚡ Context Bridge</span>
        <span class="bridge-target">Cross-Agent Handoff</span>
      </div>
      <div class="bridge-grid">
        <div class="bridge-opt">
          <div class="bridge-opt-title">
            <span class="badge antigravity">Antigravity</span>
            <span class="bridge-arrow">➔</span>
            <span class="badge claude">Claude Code</span>
          </div>
          <p class="bridge-desc">Hand off <strong>${esc(toClaude.sourceTitle)}</strong> to Claude</p>
          <div class="bridge-btns">
            <button class="btn-primary" data-action="handoff" data-id="${esc(toClaude.sourceSessionId)}">📋 Copy Handoff to Claude</button>
            <button class="btn-subtle" data-action="saveHandoff" data-id="${esc(toClaude.sourceSessionId)}">💾 Save</button>
          </div>
        </div>
        <div class="bridge-opt">
          <div class="bridge-opt-title">
            <span class="badge claude">Claude Code</span>
            <span class="bridge-arrow">➔</span>
            <span class="badge antigravity">Antigravity</span>
          </div>
          <p class="bridge-desc">Hand off <strong>${esc(toAntigravity.sourceTitle)}</strong> to Antigravity</p>
          <div class="bridge-btns">
            <button class="btn-primary" data-action="handoff" data-id="${esc(toAntigravity.sourceSessionId)}">📋 Copy Handoff to Antigravity</button>
            <button class="btn-subtle" data-action="saveHandoff" data-id="${esc(toAntigravity.sourceSessionId)}">💾 Save</button>
          </div>
        </div>
      </div>
    </div>`;
  } else if (toClaude) {
    bridgeCard = `<div class="bridge-card" role="region" aria-label="Context Bridge">
      <div class="bridge-head">
        <span class="bridge-badge">⚡ Context Bridge</span>
        <span class="bridge-target">Handoff to Claude</span>
      </div>
      <p class="bridge-desc">Switching agents? Ready to hand off <strong>${esc(toClaude.sourceTitle)}</strong> to Claude Code.</p>
      <div class="bridge-btns">
        <button class="btn-primary" data-action="handoff" data-id="${esc(toClaude.sourceSessionId)}">📋 Copy Handoff to Claude</button>
        <button class="btn-subtle" data-action="saveHandoff" data-id="${esc(toClaude.sourceSessionId)}">💾 Save .agent-handoff.md</button>
      </div>
    </div>`;
  } else if (toAntigravity) {
    bridgeCard = `<div class="bridge-card" role="region" aria-label="Context Bridge">
      <div class="bridge-head">
        <span class="bridge-badge">⚡ Context Bridge</span>
        <span class="bridge-target">Handoff to Antigravity</span>
      </div>
      <p class="bridge-desc">Switching agents? Ready to hand off <strong>${esc(toAntigravity.sourceTitle)}</strong> to Antigravity.</p>
      <div class="bridge-btns">
        <button class="btn-primary" data-action="handoff" data-id="${esc(toAntigravity.sourceSessionId)}">📋 Copy Handoff to Antigravity</button>
        <button class="btn-subtle" data-action="saveHandoff" data-id="${esc(toAntigravity.sourceSessionId)}">💾 Save .agent-handoff.md</button>
      </div>
    </div>`;
  } else if (q.contextBridge) {
    const targetName = q.contextBridge.targetAgent === 'claude' ? 'Claude' : 'Antigravity';
    bridgeCard = `<div class="bridge-card" role="region" aria-label="Context Bridge">
      <div class="bridge-head">
        <span class="bridge-badge">⚡ Context Bridge</span>
        <span class="bridge-target">Handoff to ${targetName}</span>
      </div>
      <p class="bridge-desc">Switching agents? Ready to hand off <strong>${esc(q.contextBridge.sourceTitle)}</strong> to ${targetName}.</p>
      <div class="bridge-btns">
        <button class="btn-primary" data-action="handoff" data-id="${esc(q.contextBridge.sourceSessionId)}">📋 Copy Handoff Prompt</button>
        <button class="btn-subtle" data-action="saveHandoff" data-id="${esc(q.contextBridge.sourceSessionId)}">💾 Save .agent-handoff.md</button>
      </div>
    </div>`;
  }

  const dualGraphs =
    q.claudeCard && q.antigravityCard
      ? `<div class="dual-graphs">
          ${q.agentFilter !== 'antigravity' ? renderClaudeCard(q.claudeCard) : ''}
          ${q.agentFilter !== 'claude' ? renderAntigravityCard(q.antigravityCard) : ''}
        </div>`
      : `${gauge}
        ${line('tokens', q.tokensLine)}
        ${line('pace', q.paceLine)}
        ${weekly}
        ${note}`;

  const dispatcherCard =
    q.counts && q.counts.all >= 2
      ? `<div class="dispatcher-card" role="region" aria-label="Inter-Session Dispatcher">
          <div class="disp-head">
            <span class="disp-badge">💬 Inter-Session Chat</span>
            <span class="disp-count">${q.counts.all} conversations</span>
          </div>
          <p class="disp-desc">Route instructions or context findings between your running AI sessions.</p>
          <button class="btn-primary" data-action="dispatch">💬 Route Message Between Sessions</button>
        </div>`
      : '';

  return `<section class="quota level-${q.level}" aria-label="5-hour quota">
    <div class="head"><h1>${esc(q.headline)}</h1>${q.state === 'local' ? '<span class="tag">estimate</span>' : ''}</div>
    ${line('reset', q.resetLine)}
    ${dualGraphs}
    ${bridgeCard}
    ${dispatcherCard}
  </section>`;
}

function renderSession(s: SessionVM): string {
  const ctx = s.context
    ? `<div class="ctx"><div class="track thin"><span style="width:${pct(s.context.usedPct)}%"></span></div><span>${esc(s.context.line)}</span></div>`
    : '';
  const rows = s.details.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const open = s.canOpen ? `<button class="btn-quick subtle" data-action="open" data-id="${esc(s.id)}">Open transcript</button>` : '';
  const handoffTarget = s.agent === 'claude' ? 'Antigravity' : 'Claude';
  const handoffBtn = `<button class="btn-quick" data-action="handoff" data-id="${esc(s.id)}" title="Copy handoff prompt to ${handoffTarget}">📋 Handoff to ${handoffTarget}</button>`;
  const dispatchBtn = `<button class="btn-quick subtle" data-action="dispatch" data-id="${esc(s.id)}" title="Send message or context from this session to another session">💬 Talk to...</button>`;
  const saveBtn = `<button class="btn-quick subtle" data-action="saveHandoff" data-id="${esc(s.id)}" title="Save .agent-handoff.md">💾 Save</button>`;
  const title = s.title && s.title !== s.name ? `<p class="title">${esc(s.title)}</p>` : '';
  const agentBadge = `<span class="badge ${s.agent}">${s.agent === 'antigravity' ? 'Antigravity' : 'Claude'}</span>`;
  const filesTag = s.filesTouched && s.filesTouched.length > 0 ? `<span class="files-tag">📁 ${s.filesTouched.length} modified</span>` : '';

  return `<article class="conv state-${s.state}${s.inWorkspace ? '' : ' elsewhere'}">
    <div class="row">
      <span class="dot" aria-hidden="true"></span>
      ${agentBadge}
      <h2>${esc(s.name)}</h2>
      <span class="tok" title="Tokens used in this conversation">${esc(s.tokens)}</span>
    </div>
    ${title}
    <p class="meta">${esc(s.meta)}${filesTag ? ` · ${filesTag}` : ''}</p>
    ${ctx}
    <div class="conv-actions">
      ${handoffBtn}
      ${dispatchBtn}
      ${saveBtn}
      ${open}
    </div>
    <details data-id="${esc(s.id)}">
      <summary>Token & context breakdown</summary>
      <dl>${rows}</dl>
    </details>
  </article>`;
}

export function renderBody(vm: ViewModel): string {
  const emptyText =
    vm.quota.agentFilter === 'antigravity'
      ? 'No Antigravity conversations in the last 5 hours.'
      : 'No Claude Code conversations in the last 5 hours.';

  const list = vm.sessions.length
    ? vm.sessions.map(renderSession).join('')
    : `<p class="empty">${emptyText}</p>`;

  const counts = vm.quota.counts;
  const currentFilter = vm.quota.agentFilter || 'all';
  const filterTabs = counts && counts.all > 0
    ? `<div class="filter-tabs">
        <button class="tab-btn${currentFilter === 'all' ? ' active' : ''}" data-action="filter" data-filter="all">All (${counts.all})</button>
        <button class="tab-btn${currentFilter === 'claude' ? ' active' : ''}" data-action="filter" data-filter="claude">Claude (${counts.claude})</button>
        <button class="tab-btn${currentFilter === 'antigravity' ? ' active' : ''}" data-action="filter" data-filter="antigravity">Antigravity (${counts.antigravity})</button>
      </div>`
    : '';

  return `${renderQuota(vm.quota)}
  <div class="list-head">
    <h2>Conversations</h2>
    <button class="link" data-action="refresh">Refresh</button>
  </div>
  ${filterTabs}
  ${list}`;
}
