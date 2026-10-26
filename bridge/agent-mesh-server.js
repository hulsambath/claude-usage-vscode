#!/usr/bin/env node
/**
 * Agent Mesh MCP Server
 * Standard Model Context Protocol (MCP) JSON-RPC stdio server for peer-to-peer AI agent communication.
 * Enables Claude Code and Antigravity to list peers, delegate tasks, and exchange context.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STATE_PATH = path.join(os.homedir(), '.claude', 'agent-mesh-state.json');

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      return {
        version: 1,
        lastUpdated: Date.now(),
        activeAgents: [
          { agent: 'claude', status: 'idle', lastActive: Date.now() },
          { agent: 'antigravity', status: 'idle', lastActive: Date.now() },
        ],
        messages: [],
      };
    }
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, lastUpdated: Date.now(), activeAgents: [], messages: [] };
  }
}

function writeState(state) {
  try {
    state.lastUpdated = Date.now();
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal
  }
}

const TOOLS = [
  {
    name: 'list_peer_agents',
    description: 'Lists available peer AI agents (Claude Code, Antigravity) and their active status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'delegate_task',
    description:
      'Delegates a subtask to another peer agent (e.g. ask Antigravity to build Flutter UI or Claude to implement backend/tests).',
    inputSchema: {
      type: 'object',
      properties: {
        to_agent: {
          type: 'string',
          enum: ['claude', 'antigravity'],
          description: 'Target agent for the task',
        },
        task_title: { type: 'string', description: 'Brief title of the task' },
        instructions: { type: 'string', description: 'Detailed instructions and requirements' },
        context_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to files modified or relevant to this task',
        },
      },
      required: ['to_agent', 'instructions'],
    },
  },
  {
    name: 'send_message',
    description: 'Sends a direct message, question, or notification to a peer agent.',
    inputSchema: {
      type: 'object',
      properties: {
        to_agent: { type: 'string', description: 'Recipient agent (claude or antigravity)' },
        message: { type: 'string', description: 'Message content' },
      },
      required: ['to_agent', 'message'],
    },
  },
  {
    name: 'check_inbox',
    description: 'Checks incoming messages and delegated tasks sent to this agent from peers.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'Your agent identity (claude or antigravity)' },
        unread_only: { type: 'boolean', description: 'Whether to only return unread messages' },
      },
      required: ['agent_name'],
    },
  },
  {
    name: 'report_result',
    description: 'Reports task completion and artifacts back to the orchestrator or peer.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task' },
        summary: { type: 'string', description: 'Summary of completed work' },
        files_modified: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files touched or created',
        },
      },
      required: ['summary'],
    },
  },
];

function handleToolCall(name, args) {
  const state = readState();

  if (name === 'list_peer_agents') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              agents: [
                {
                  agent: 'claude',
                  name: 'Claude Code',
                  specialties: ['Backend Architecture', 'Algorithms', 'Refactoring', 'Unit Testing'],
                  status: 'ready',
                },
                {
                  agent: 'antigravity',
                  name: 'Antigravity (Gemini)',
                  specialties: ['Flutter/Dart', 'Frontend UI', 'Rapid Prototyping', 'Monorepo Tasks'],
                  status: 'ready',
                },
              ],
              serverTime: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  if (name === 'delegate_task') {
    const toAgent = String(args.to_agent || 'antigravity').toLowerCase();
    const taskTitle = args.task_title || 'Delegated Subtask';
    const instructions = args.instructions || '';
    const contextFiles = Array.isArray(args.context_files) ? args.context_files : [];

    const msgId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const msg = {
      id: msgId,
      fromAgent: toAgent === 'claude' ? 'antigravity' : 'claude',
      toAgent,
      type: 'task_delegation',
      subject: taskTitle,
      content: instructions,
      contextFiles,
      timestamp: Date.now(),
      status: 'unread',
    };

    state.messages.push(msg);
    if (state.messages.length > 100) state.messages = state.messages.slice(-100);
    writeState(state);

    return {
      content: [
        {
          type: 'text',
          text: `Task delegated successfully to ${toAgent.toUpperCase()}!\nTask ID: ${msgId}\nSubject: ${taskTitle}\nTarget agent will see this in their inbox and via the VS Code Orchestrator Conductor.`,
        },
      ],
    };
  }

  if (name === 'send_message') {
    const toAgent = String(args.to_agent || '').toLowerCase();
    const message = args.message || '';
    const msgId = `msg-${Date.now().toString(36)}`;

    const msg = {
      id: msgId,
      fromAgent: toAgent === 'claude' ? 'antigravity' : 'claude',
      toAgent,
      type: 'question',
      subject: 'Peer Message',
      content: message,
      timestamp: Date.now(),
      status: 'unread',
    };

    state.messages.push(msg);
    if (state.messages.length > 100) state.messages = state.messages.slice(-100);
    writeState(state);

    return {
      content: [
        {
          type: 'text',
          text: `Message sent to ${toAgent} (ID: ${msgId}). Delivered to local Agent Mesh.`,
        },
      ],
    };
  }

  if (name === 'check_inbox') {
    const agentName = String(args.agent_name || '').toLowerCase();
    const unreadOnly = Boolean(args.unread_only);

    const matches = state.messages.filter((m) => {
      const match = m.toAgent.toLowerCase().includes(agentName) || m.toAgent === 'all';
      if (!match) return false;
      return unreadOnly ? m.status === 'unread' : true;
    });

    // Mark retrieved unread messages as read
    for (const m of matches) {
      if (m.status === 'unread') m.status = 'read';
    }
    writeState(state);

    return {
      content: [
        {
          type: 'text',
          text:
            matches.length === 0
              ? `No messages in inbox for ${agentName}.`
              : `Inbox for ${agentName} (${matches.length} message(s)):\n\n` +
                matches
                  .map(
                    (m) =>
                      `• [${m.type.toUpperCase()}] From ${m.fromAgent} at ${new Date(m.timestamp).toLocaleTimeString()}:\n` +
                      `  Subject: ${m.subject}\n` +
                      `  Content: ${m.content}\n` +
                      (m.contextFiles && m.contextFiles.length > 0
                        ? `  Context Files: ${m.contextFiles.join(', ')}\n`
                        : ''),
                  )
                  .join('\n---\n'),
        },
      ],
    };
  }

  if (name === 'report_result') {
    const summary = args.summary || '';
    const files = Array.isArray(args.files_modified) ? args.files_modified : [];
    const taskId = args.task_id || 'task-completed';

    const msg = {
      id: `res-${Date.now().toString(36)}`,
      fromAgent: 'worker',
      toAgent: 'all',
      type: 'task_result',
      subject: `Task Result: ${taskId}`,
      content: summary,
      contextFiles: files,
      timestamp: Date.now(),
      status: 'unread',
    };

    state.messages.push(msg);
    writeState(state);

    return {
      content: [
        {
          type: 'text',
          text: `Task result reported to Agent Mesh! Files recorded: ${files.length}. Orchestrator notified.`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function processLine(line) {
  if (!line || !line.trim()) return;
  let req;
  try {
    req = JSON.parse(line.trim());
  } catch {
    return;
  }

  const id = req.id;
  const method = req.method;

  if (method === 'initialize') {
    const res = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'agent-mesh-server',
          version: '1.0.0',
        },
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (method === 'notifications/initialized') {
    return; // Notification, no reply needed
  }

  if (method === 'tools/list') {
    const res = {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS,
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = req.params || {};
    try {
      const result = handleToolCall(name, args || {});
      const res = {
        jsonrpc: '2.0',
        id,
        result,
      };
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch (err) {
      const res = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message,
        },
      };
      process.stdout.write(JSON.stringify(res) + '\n');
    }
    return;
  }

  if (id !== undefined) {
    const res = {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', processLine);
