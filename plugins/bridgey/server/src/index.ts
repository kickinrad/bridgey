import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DaemonClient } from './daemon-client.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'bridgey',
  version: '0.1.0',
});

const daemonPort = parseInt(process.env.BRIDGEY_DAEMON_PORT || '8092', 10);
const client = new DaemonClient(daemonPort);

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
