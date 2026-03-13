import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DaemonClient } from './daemon-client.js';

export function registerTools(server: McpServer, client: DaemonClient): void {
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
