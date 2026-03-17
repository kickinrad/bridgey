import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sendA2AMessage, checkHealth, fetchAgentCard } from './a2a-client.js';
import { resolveToken } from './config.js';
import { scanTailnet } from './discovery.js';
import type { ConnectConfig, AgentStatus } from './types.js';

export function registerTools(server: McpServer, config: ConnectConfig): void {
  // In-memory store for discovered agents (merged with config)
  const discoveredAgents: Map<string, { url: string; token?: string }> = new Map();

  function getAgent(name: string): { url: string; token?: string } | undefined {
    const configured = config.agents[name];
    if (configured) {
      return { url: configured.url, token: resolveToken(configured.token) };
    }
    return discoveredAgents.get(name);
  }

  function getAllAgents(): Array<{ name: string; url: string; token?: string; source: 'config' | 'discovered' }> {
    const agents: Array<{ name: string; url: string; token?: string; source: 'config' | 'discovered' }> = [];

    for (const [name, cfg] of Object.entries(config.agents)) {
      agents.push({ name, url: cfg.url, token: resolveToken(cfg.token), source: 'config' });
    }

    for (const [name, info] of discoveredAgents) {
      if (!config.agents[name]) {
        agents.push({ name, url: info.url, token: info.token, source: 'discovered' });
      }
    }

    return agents;
  }

  // -------------------------------------------------------------------
  // connect_send — send a message to a remote agent
  // -------------------------------------------------------------------
  server.tool(
    'connect_send',
    'Send a message to a remote agent and get their response. The agent processes the message via Claude and returns the result.',
    {
      agent: z.string().describe('Name of the target agent to message'),
      message: z.string().describe('The message to send to the agent'),
      context_id: z.string().optional().describe('Optional conversation context ID to continue a previous thread'),
    },
    async ({ agent, message, context_id }) => {
      const agentInfo = getAgent(agent);
      if (!agentInfo) {
        const available = getAllAgents().map((a) => a.name).join(', ') || 'none';
        return {
          content: [{
            type: 'text' as const,
            text: `Unknown agent "${agent}". Available agents: ${available}. Use connect_list_agents to see all agents.`,
          }],
        };
      }

      const response = await sendA2AMessage(agentInfo.url, message, {
        token: agentInfo.token,
        contextId: context_id,
        timeoutMs: config.defaults.timeout_ms,
        maxAttempts: config.defaults.retry_attempts,
      });

      return {
        content: [{
          type: 'text' as const,
          text: response || '(Agent returned an empty response)',
        }],
      };
    },
  );

  // -------------------------------------------------------------------
  // connect_list_agents — list all agents with live status
  // -------------------------------------------------------------------
  server.tool(
    'connect_list_agents',
    'List all configured and discovered remote agents with their online/offline status.',
    {},
    async () => {
      const agents = getAllAgents();

      if (agents.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No agents configured. Create a config at ~/.bridgey/connect.json or use connect_discover to scan your Tailscale network.',
          }],
        };
      }

      const statuses: AgentStatus[] = await Promise.all(
        agents.map(async (a) => {
          const health = await checkHealth(a.url);
          return { name: a.name, url: a.url, online: health !== null, source: a.source };
        }),
      );

      const header = `Agents (${statuses.length}):`;
      const separator = '-'.repeat(70);
      const colHeader = `    ${'Name'.padEnd(16)} ${'Status'.padEnd(10)} ${'Source'.padEnd(12)} URL`;
      const rows = statuses.map((a) => {
        const icon = a.online ? '[ok]' : '[--]';
        const status = a.online ? 'online' : 'offline';
        return `${icon} ${a.name.padEnd(16)} ${status.padEnd(10)} ${a.source.padEnd(12)} ${a.url}`;
      });

      const text = [header, separator, colHeader, separator, ...rows].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // -------------------------------------------------------------------
  // connect_agent_info — fetch a specific agent's card
  // -------------------------------------------------------------------
  server.tool(
    'connect_agent_info',
    "Fetch a remote agent's card to see its name, description, capabilities, and skills.",
    {
      agent: z.string().describe('Name of the agent to get info for'),
    },
    async ({ agent }) => {
      const agentInfo = getAgent(agent);
      if (!agentInfo) {
        return {
          content: [{
            type: 'text' as const,
            text: `Unknown agent "${agent}". Use connect_list_agents to see available agents.`,
          }],
        };
      }

      const card = await fetchAgentCard(agentInfo.url);
      if (!card) {
        return {
          content: [{
            type: 'text' as const,
            text: `Could not fetch agent card from ${agentInfo.url} — agent may be offline.`,
          }],
        };
      }

      const lines = [
        `Agent: ${card.name}`,
        card.description ? `Description: ${card.description}` : null,
        card.url ? `URL: ${card.url}` : null,
        card.version ? `Version: ${card.version}` : null,
      ].filter(Boolean) as string[];

      if (card.capabilities) {
        lines.push('', 'Capabilities:');
        for (const [key, val] of Object.entries(card.capabilities)) {
          lines.push(`  ${key}: ${JSON.stringify(val)}`);
        }
      }

      if (card.skills?.length) {
        lines.push('', 'Skills:');
        for (const skill of card.skills) {
          lines.push(`  - ${skill.name}${skill.description ? `: ${skill.description}` : ''}`);
        }
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // -------------------------------------------------------------------
  // connect_discover — scan Tailscale for bridgey agents
  // -------------------------------------------------------------------
  server.tool(
    'connect_discover',
    'Scan your Tailscale network for bridgey agents. Requires the tailscale CLI to be installed. Discovered agents are available for the current session.',
    {},
    async () => {
      if (!config.tailscale.enabled) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Tailscale discovery is disabled. Enable it in ~/.bridgey/connect.json:\n\n  "tailscale": { "enabled": true, "probe_port": 8092 }',
          }],
        };
      }

      try {
        const agents = await scanTailnet({
          bridgey_port: config.tailscale.probe_port,
          probe_timeout_ms: config.tailscale.probe_timeout_ms,
          exclude_peers: config.tailscale.exclude_peers,
        });

        if (agents.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No bridgey agents found on your Tailscale network. Make sure remote daemons are running and bound to 0.0.0.0.',
            }],
          };
        }

        // Merge discovered agents into session store
        for (const agent of agents) {
          if (!discoveredAgents.has(agent.name)) {
            discoveredAgents.set(agent.name, { url: agent.url });
          }
        }

        const lines = agents.map((a) => `  - ${a.name} at ${a.url} (${a.hostname})`);
        const text = [
          `Discovered ${agents.length} agent(s) on your tailnet:`,
          '',
          ...lines,
          '',
          'These agents are now available for this session. Use connect_send to message them.',
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Tailscale CLI not found. Install Tailscale to use network discovery: https://tailscale.com/download',
            }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Discovery failed: ${msg}` }],
        };
      }
    },
  );
}
