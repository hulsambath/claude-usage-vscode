#!/usr/bin/env node
// Claude Code statusLine command for the Claude Usage Monitor extension.
// Claude Code pipes session JSON (including rate_limits, the only local source
// of the 5-hour quota) to stdin on every status refresh. This script saves a
// small snapshot per session for the extension and prints a short status line.
// Zero dependencies; must never throw, or the status line goes blank.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SAFE_ID = /^[A-Za-z0-9-]+$/;

function pct(n) {
  return `${Math.round(n)}%`;
}

function handle(input, dir, nowMs) {
  if (!input || typeof input !== 'object') return '';
  const rl = input.rate_limits || undefined;
  const cw = input.context_window || {};
  const ctx = cw.used_percentage;

  if (typeof input.session_id === 'string' && SAFE_ID.test(input.session_id)) {
    const snap = {
      session_id: input.session_id,
      session_name: input.session_name,
      cwd: input.cwd,
      model: input.model ? input.model.display_name || input.model.id : undefined,
      context_used_percentage: ctx,
      context_window_size: cw.context_window_size,
      context_tokens: cw.total_input_tokens,
      rate_limits: rl ? { five_hour: rl.five_hour, seven_day: rl.seven_day } : undefined,
      written_at: nowMs,
    };
    try {
      const sessions = path.join(dir, 'sessions');
      fs.mkdirSync(sessions, { recursive: true });
      const target = path.join(sessions, `${input.session_id}.json`);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snap));
      fs.renameSync(tmp, target);
    } catch {
      // A failed snapshot must not break the status line.
    }
  }

  const parts = [];
  if (rl && rl.five_hour && typeof rl.five_hour.used_percentage === 'number') {
    parts.push(`5h ${pct(rl.five_hour.used_percentage)}`);
  }
  if (typeof ctx === 'number') parts.push(`ctx ${pct(ctx)}`);
  return parts.join(' · ');
}

module.exports = { handle };

if (require.main === module) {
  const dir = process.env.CLAUDE_USAGE_DIR || path.join(os.homedir(), '.claude', 'usage-monitor');
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      input = undefined;
    }
    process.stdout.write(handle(input, dir, Date.now()));
  });
}
