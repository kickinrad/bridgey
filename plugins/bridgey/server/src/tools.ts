import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BridgeyClient } from './types.js';
import { DaemonClient } from './daemon-client.js';
import { loadConfig, saveConfig } from './config.js';
import { scanTailnet } from '../../daemon/src/tailscale/scanner.js';
import {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from '../../daemon/src/tailscale/registrar.js';
import { loadConfig as loadTailscaleConfig } from '../../daemon/src/tailscale/config.js';

// ---------------------------------------------------------------------------
// File safety — refuse to send files from ~/.bridgey/
// ---------------------------------------------------------------------------

function assertSendable(filePath: string): void {
  const resolved = resolve(filePath);
  const stateDir = resolve(homedir(), '.bridgey');
  if (resolved.startsWith(stateDir)) {
    throw new Error(`Refusing to send file from bridgey state directory: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// Tool definitions — returned for ListToolsRequestSchema handler
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'send',
      description:
        'Send a message to another agent and get their response. Use this to ask questions, delegate tasks, or communicate with other Claude Code instances.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Name of the target agent to message' },
          message: { type: 'string', description: 'The message to send to the agent' },
          context_id: {
            type: 'string',
            description: 'Optional conversation context ID to continue a previous thread',
          },
        },
        required: ['agent', 'message'],
      },
    },
    {
      name: 'list_agents',
      description:
        'List all known agents that bridgey can communicate with, including their status and connection info.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_inbox',
      description: 'View recent messages sent to and from other agents.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of messages to return (default: 10)',
          },
        },
      },
    },
    {
      name: 'status',
      description:
        'Check the health of the bridgey daemon, the status of all connected agents, and active transports.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'tailscale_scan',
      description:
        'Scan your Tailscale network for devices running bridgey and register them as agents.',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Re-probe all peers even if already registered',
          },
        },
      },
    },
    {
      name: 'reply',
      description:
        'Reply to a message received via a channel (Discord, Telegram, etc). Use the chat_id from the incoming channel message.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Routing key from the incoming channel message' },
          text: { type: 'string', description: 'Reply text' },
          reply_to: {
            type: 'string',
            description: 'Optional message ID to reply to (thread)',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional file paths to attach',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'react',
      description:
        'Add an emoji reaction to a message received via a channel (Discord, Telegram, etc).',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Routing key from the incoming channel message' },
          message_id: { type: 'string', description: 'ID of the message to react to' },
          emoji: { type: 'string', description: 'Emoji to react with (e.g. "👍")' },
        },
        required: ['chat_id', 'message_id', 'emoji'],
      },
    },
    {
      name: 'download_attachment',
      description:
        'Download a file attachment from a channel message to the local inbox directory.',
      inputSchema: {
        type: 'object',
        properties: {
          attachment_id: { type: 'string', description: 'Attachment ID from the channel message' },
          filename: { type: 'string', description: 'Filename to save as' },
        },
        required: ['attachment_id', 'filename'],
      },
    },
    {
      name: 'configure_agent',
      description:
        'Add or update a remote agent\'s connection info. Use this when someone shares their bridgey connection details (name, url, token).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name' },
          url: { type: 'string', description: 'Agent daemon URL (e.g. http://100.64.1.2:8092)' },
          token: { type: 'string', description: 'Bearer token for authentication (brg_...)' },
        },
        required: ['name', 'url', 'token'],
      },
    },
    {
      name: 'remove_agent',
      description:
        'Remove a remote agent from the local config.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the agent to remove' },
        },
        required: ['name'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool handler — dispatches tool calls by name
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  switch (name) {
    case 'send':
      return handleSend(args, client);
    case 'list_agents':
      return handleListAgents(client);
    case 'get_inbox':
      return handleGetInbox(args, client);
    case 'status':
      return handleStatus(client);
    case 'tailscale_scan':
      return handleTailscaleScan(args);
    case 'reply':
      return handleReply(args, client);
    case 'react':
      return handleReact(args, client);
    case 'download_attachment':
      return handleDownloadAttachment(args, client);
    case 'configure_agent':
      return handleConfigureAgent(args);
    case 'remove_agent':
      return handleRemoveAgent(args);
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// Individual tool handlers
// ---------------------------------------------------------------------------

async function handleSend(
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const agent = args.agent as string;
  const message = args.message as string;
  const contextId = args.context_id as string | undefined;

  const result = await client.send(agent, message, contextId);

  if (result.error) {
    return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
  }

  return {
    content: [{ type: 'text', text: result.response ?? '(Agent returned an empty response)' }],
  };
}

async function handleListAgents(
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let agents;
  try {
    agents = await client.listAgents();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }] };
  }

  if (agents.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No agents registered. Add agents to your bridgey config or wait for discovery.',
        },
      ],
    };
  }

  const header = `${'Name'.padEnd(20)} ${'Status'.padEnd(12)} ${'Source'.padEnd(12)} URL`;
  const separator = '-'.repeat(header.length + 20);
  const rows = agents.map((a) => {
    const statusIcon = a.status === 'online' ? '[ok]' : '[--]';
    return `${statusIcon} ${a.name.padEnd(16)} ${a.status.padEnd(12)} ${a.source.padEnd(12)} ${a.url}`;
  });

  const text = [
    `Agents (${agents.length}):`,
    separator,
    `    ${'Name'.padEnd(16)} ${'Status'.padEnd(12)} ${'Source'.padEnd(12)} URL`,
    separator,
    ...rows,
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

async function handleGetInbox(
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = (args.limit as number) ?? 10;

  let messages;
  try {
    messages = await client.getMessages(limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }] };
  }

  if (messages.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No messages yet. Use send to start a conversation with another agent.',
        },
      ],
    };
  }

  const lines = messages.map((m) => {
    const arrow = m.direction === 'outbound' ? '\u2192' : '\u2190';
    const preview = m.message.length > 80 ? m.message.slice(0, 77) + '...' : m.message;
    const time = formatTimestamp(m.created_at);
    const ctx = m.context_id ? ` [ctx:${m.context_id.slice(0, 8)}]` : '';
    return `${arrow} ${m.agent_name.padEnd(16)} ${time}${ctx}\n  ${preview}`;
  });

  const text = [`Messages (${messages.length}):`, '', ...lines].join('\n');

  return { content: [{ type: 'text', text }] };
}

async function handleStatus(
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const sections: string[] = [];

  // Daemon health
  let healthOk = false;
  try {
    const h = await client.health();
    healthOk = true;
    const uptime = formatUptime(h.uptime);
    sections.push(`Daemon: ${h.status}`, `  Name:   ${h.name}`, `  Uptime: ${uptime}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sections.push(`Daemon: UNREACHABLE`, `  ${msg}`);
  }

  // Agent summary
  if (healthOk) {
    try {
      const agents = await client.listAgents();
      const online = agents.filter((a) => a.status === 'online').length;
      sections.push('');
      sections.push(`Agents: ${online}/${agents.length} online`);

      for (const a of agents) {
        const icon = a.status === 'online' ? '[ok]' : '[--]';
        const lastSeen = a.last_seen ? ` (last seen: ${formatTimestamp(a.last_seen)})` : '';
        sections.push(`  ${icon} ${a.name} — ${a.status}${lastSeen}`);
      }
    } catch {
      sections.push('', 'Agents: unable to retrieve agent list');
    }

    // Transport status (only available on DaemonClient)
    if (client instanceof DaemonClient) {
      try {
        const transports = await client.getTransports();
        if (transports && Array.isArray(transports) && transports.length > 0) {
          sections.push('');
          sections.push(`Transports: ${transports.length} registered`);
          for (const t of transports) {
            const icon = t.healthy ? '[ok]' : '[--]';
            sections.push(`  ${icon} ${t.name} (${t.capabilities.join(', ')}) — ${t.healthy ? 'connected' : 'disconnected'}`);
          }
        }
      } catch {
        // transports endpoint may not exist yet — silently skip
      }
    }

    // Connection info — share this so other Claude instances can reach you
    const config = loadConfig();
    if (config) {
      const daemonPort = (config as Record<string, unknown>).port ?? 8092;
      const daemonBind = (config as Record<string, unknown>).bind as string | undefined;
      const token = (config as Record<string, unknown>).token as string | undefined;
      const name = config.name ?? 'unnamed';

      // Build URL: use bind address if non-localhost, otherwise show placeholder
      let host: string;
      if (daemonBind && daemonBind !== '127.0.0.1' && daemonBind !== 'localhost') {
        host = daemonBind === '0.0.0.0' ? '<your-ip>' : daemonBind;
      } else {
        host = '<your-ip>';
      }
      const url = `http://${host}:${daemonPort}`;

      if (token) {
        sections.push('');
        sections.push('Connection Info (share this to let other Claude instances reach you):');
        sections.push(`  { "name": "${name}", "url": "${url}", "token": "${token}" }`);
        sections.push('');
        sections.push('The receiving Claude can use the configure_agent tool to add this agent.');
      }
    }
  }

  return { content: [{ type: 'text', text: sections.join('\n') }] };
}

async function handleTailscaleScan(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const config = loadTailscaleConfig(process.env.BRIDGEY_TAILSCALE_CONFIG);

  const local = readLocalDaemon();
  if (!local) {
    return {
      content: [
        { type: 'text', text: 'No local bridgey daemon found. Run /bridgey:setup first.' },
      ],
    };
  }

  const port = new URL(local.url).port;
  if (port) config.bridgey_port = parseInt(port, 10);

  try {
    const discovered = await scanTailnet(config);
    const existing = listTailnetAgents();
    const discoveredNames = discovered.map((a) => a.name);

    for (const agent of discovered) {
      registerTailnetAgent({
        name: agent.name,
        url: agent.url,
        hostname: agent.hostname,
        tailscale_ip: agent.tailscale_ip,
      });
    }

    const removed = removeStaleTailnetAgents(discoveredNames);
    const newAgents = discovered.filter((d) => !existing.some((e) => e.name === d.name));

    const lines: string[] = [];
    if (discovered.length === 0) {
      lines.push('No bridgey agents found on your tailnet.');
    } else {
      lines.push(`Found ${discovered.length} bridgey agent(s) on tailnet:`);
      for (const a of discovered) {
        const tag = newAgents.some((n) => n.name === a.name) ? ' (new!)' : '';
        lines.push(`  - ${a.name} @ ${a.hostname} (${a.tailscale_ip})${tag}`);
      }
    }
    if (removed.length > 0) {
      lines.push(`\nRemoved ${removed.length} stale agent(s): ${removed.join(', ')}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return {
        content: [
          {
            type: 'text',
            text: 'Tailscale CLI not found. Install Tailscale: https://tailscale.com/download',
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: `Scan failed: ${msg}` }] };
  }
}

async function handleReply(
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!(client instanceof DaemonClient)) {
    return {
      content: [
        { type: 'text', text: 'Reply requires a running bridgey daemon. Channel features are not available in orchestrator mode.' },
      ],
      isError: true,
    };
  }

  const chatId = args.chat_id as string;
  const text = args.text as string;
  const replyTo = args.reply_to as string | undefined;
  const files = args.files as string[] | undefined;

  // Safety check — refuse to send files from ~/.bridgey/
  if (files) {
    for (const f of files) {
      assertSendable(f);
    }
  }

  try {
    const result = await client.reply(chatId, text, replyTo, files);
    return {
      content: [{ type: 'text', text: result.ok ? 'Reply sent.' : `Reply failed: ${JSON.stringify(result)}` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Reply failed: ${msg}` }], isError: true };
  }
}

async function handleReact(
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!(client instanceof DaemonClient)) {
    return {
      content: [
        { type: 'text', text: 'React requires a running bridgey daemon. Channel features are not available in orchestrator mode.' },
      ],
      isError: true,
    };
  }

  const chatId = args.chat_id as string;
  const messageId = args.message_id as string;
  const emoji = args.emoji as string;

  try {
    const result = await client.react(chatId, messageId, emoji);
    return {
      content: [{ type: 'text', text: result.ok ? 'Reaction added.' : `React failed: ${JSON.stringify(result)}` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `React failed: ${msg}` }], isError: true };
  }
}

async function handleDownloadAttachment(
  args: Record<string, unknown>,
  client: BridgeyClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!(client instanceof DaemonClient)) {
    return {
      content: [
        { type: 'text', text: 'Download requires a running bridgey daemon. Channel features are not available in orchestrator mode.' },
      ],
      isError: true,
    };
  }

  const attachmentId = args.attachment_id as string;
  const filename = args.filename as string;

  try {
    const data = await client.downloadAttachment(attachmentId);
    const inboxDir = resolve(homedir(), '.bridgey', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    const outPath = resolve(inboxDir, filename);
    writeFileSync(outPath, Buffer.from(data));
    return {
      content: [{ type: 'text', text: `Downloaded to ${outPath}` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Download failed: ${msg}` }], isError: true };
  }
}

async function handleConfigureAgent(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const name = args.name as string;
  const url = args.url as string;
  const token = args.token as string;

  if (!name || !url || !token) {
    return {
      content: [{ type: 'text', text: 'Missing required fields: name, url, and token are all required.' }],
      isError: true,
    };
  }

  const config = loadConfig() ?? { name: 'unnamed', agents: [] };
  if (!config.agents) config.agents = [];

  const existing = config.agents.findIndex((a) => a.name === name);
  if (existing >= 0) {
    config.agents[existing] = { name, url, token };
  } else {
    config.agents.push({ name, url, token });
  }

  saveConfig(config);

  const verb = existing >= 0 ? 'Updated' : 'Added';
  return {
    content: [{ type: 'text', text: `${verb} agent "${name}" (${url}). It will be available on next daemon restart or in orchestrator mode immediately.` }],
  };
}

async function handleRemoveAgent(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const name = args.name as string;

  if (!name) {
    return {
      content: [{ type: 'text', text: 'Missing required field: name.' }],
      isError: true,
    };
  }

  const config = loadConfig();
  if (!config?.agents?.length) {
    return {
      content: [{ type: 'text', text: `No agents configured. Nothing to remove.` }],
    };
  }

  const before = config.agents.length;
  config.agents = config.agents.filter((a) => a.name !== name);

  if (config.agents.length === before) {
    return {
      content: [{ type: 'text', text: `Agent "${name}" not found in config.` }],
    };
  }

  saveConfig(config);
  return {
    content: [{ type: 'text', text: `Removed agent "${name}" from config.` }],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return iso;
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
