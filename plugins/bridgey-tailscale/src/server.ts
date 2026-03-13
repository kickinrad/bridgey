import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { scanTailnet } from './scanner.js';
import {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from './registrar.js';

const server = new McpServer({ name: 'bridgey-tailscale', version: '0.1.0' });

server.tool(
  'bridgey_tailscale_scan',
  'Scan your Tailscale network for devices running bridgey and register them as agents. Returns list of discovered, existing, and removed agents.',
  { force: z.boolean().optional().describe('Re-probe all peers even if already registered') },
  async ({ force }) => {
    const config = loadConfig(process.env.BRIDGEY_TAILSCALE_CONFIG);

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
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
