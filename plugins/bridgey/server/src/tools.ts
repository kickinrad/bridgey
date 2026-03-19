import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeyClient } from './types.js';
import { scanTailnet } from '../../daemon/src/tailscale/scanner.js';
import {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from '../../daemon/src/tailscale/registrar.js';
import { loadConfig as loadTailscaleConfig } from '../../daemon/src/tailscale/config.js';

export function registerTools(server: McpServer, client: BridgeyClient): void {
  // -------------------------------------------------------------------
  // bridgey_send — send a message to another agent
  // -------------------------------------------------------------------
  server.tool(
    'bridgey_send',
    'Send a message to another agent and get their response. Use this to ask questions, delegate tasks, or communicate with other Claude Code instances.',
    {
      agent: z.string().describe('Name of the target agent to message'),
      message: z.string().describe('The message to send to the agent'),
      context_id: z.string().optional().describe('Optional conversation context ID to continue a previous thread'),
    },
    async ({ agent, message, context_id }) => {
      const result = await client.send(agent, message, context_id);

      if (result.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: result.response ?? '(Agent returned an empty response)',
        }],
      };
    },
  );

  // -------------------------------------------------------------------
  // bridgey_list_agents — list all known agents
  // -------------------------------------------------------------------
  server.tool(
    'bridgey_list_agents',
    'List all known agents that bridgey can communicate with, including their status and connection info.',
    {},
    async () => {
      let agents;
      try {
        agents = await client.listAgents();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: msg }] };
      }

      if (agents.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No agents registered. Add agents to your bridgey config or wait for discovery.',
          }],
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

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // -------------------------------------------------------------------
  // bridgey_get_inbox — view recent messages
  // -------------------------------------------------------------------
  server.tool(
    'bridgey_get_inbox',
    'View recent messages sent to and from other agents.',
    {
      limit: z.number().optional().default(10).describe('Maximum number of messages to return (default: 10)'),
    },
    async ({ limit }) => {
      let messages;
      try {
        messages = await client.getMessages(limit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: msg }] };
      }

      if (messages.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No messages yet. Use bridgey_send to start a conversation with another agent.',
          }],
        };
      }

      const lines = messages.map((m) => {
        const arrow = m.direction === 'outbound' ? '\u2192' : '\u2190';
        const preview = m.message.length > 80
          ? m.message.slice(0, 77) + '...'
          : m.message;
        const time = formatTimestamp(m.created_at);
        const ctx = m.context_id ? ` [ctx:${m.context_id.slice(0, 8)}]` : '';
        return `${arrow} ${m.agent_name.padEnd(16)} ${time}${ctx}\n  ${preview}`;
      });

      const text = [
        `Messages (${messages.length}):`,
        '',
        ...lines,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // -------------------------------------------------------------------
  // bridgey_agent_status — daemon health + agent status overview
  // -------------------------------------------------------------------
  server.tool(
    'bridgey_agent_status',
    'Check the health of the bridgey daemon and the status of all connected agents.',
    {},
    async () => {
      const sections: string[] = [];

      // Daemon health
      let healthOk = false;
      try {
        const h = await client.health();
        healthOk = true;
        const uptime = formatUptime(h.uptime);
        sections.push(
          `Daemon: ${h.status}`,
          `  Name:   ${h.name}`,
          `  Uptime: ${uptime}`,
        );
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
      }

      return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
    },
  );

  // -------------------------------------------------------------------
  // bridgey_tailscale_scan — scan tailnet for bridgey agents
  // -------------------------------------------------------------------
  server.tool(
    'bridgey_tailscale_scan',
    'Scan your Tailscale network for devices running bridgey and register them as agents. Returns list of discovered, existing, and removed agents.',
    { force: z.boolean().optional().describe('Re-probe all peers even if already registered') },
    async ({ force }) => {
      const config = loadTailscaleConfig(process.env.BRIDGEY_TAILSCALE_CONFIG);

      const local = readLocalDaemon();
      if (!local) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No local bridgey daemon found. Run /bridgey:setup first.',
          }],
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
        const newAgents = discovered.filter(
          (d) => !existing.some((e) => e.name === d.name)
        );

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

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Tailscale CLI not found. Install Tailscale: https://tailscale.com/download',
            }],
          };
        }
        return { content: [{ type: 'text' as const, text: `Scan failed: ${msg}` }] };
      }
    },
  );
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
