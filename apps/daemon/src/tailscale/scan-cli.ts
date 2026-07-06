import { loadConfig } from './config.js';
import { scanTailnet } from './scanner.js';
import { readLocalDaemon, registerTailnetAgent, removeStaleTailnetAgents } from './registrar.js';

async function main(): Promise<void> {
  const configPath = process.argv.find((_, i, a) => a[i - 1] === '--config');
  const config = loadConfig(configPath);

  if (!config.scan_on_session_start) {
    process.exit(0);
  }

  const local = readLocalDaemon();
  if (!local) {
    process.exit(0);
  }

  const port = new URL(local.url).port;
  if (port) config.bridgey_port = parseInt(port, 10);

  try {
    const discovered = await scanTailnet(config);
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

    console.log(JSON.stringify({
      status: 'ok',
      discovered: discovered.map((a) => ({ name: a.name, hostname: a.hostname, url: a.url })),
      removed,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT') || message.includes('not found')) {
      process.exit(0);
    }
    console.error(JSON.stringify({ status: 'error', message }));
    process.exit(1);
  }
}

main();
