import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DaemonClient } from './daemon-client.js';
import { OrchestratorClient } from './orchestrator-client.js';
import { loadConfig, resolveAgentName } from './config.js';
import { registerTools } from './tools.js';
import type { BridgeyClient } from './types.js';

const server = new McpServer({
  name: 'bridgey',
  version: '0.2.0',
});

async function createClient(): Promise<BridgeyClient> {
  // Try local daemon first (current behavior)
  const daemon = new DaemonClient();
  try {
    await daemon.health();
    return daemon;
  } catch {
    // Daemon unreachable — try orchestrator mode
  }

  const config = loadConfig();
  if (!config?.agents?.length) {
    // No config or no agents — fall back to daemon client
    // (tools will show "daemon unreachable" errors with troubleshooting hints)
    return daemon;
  }

  const agentName = resolveAgentName(config);
  return new OrchestratorClient(agentName, config.agents);
}

const client = await createClient();
registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
