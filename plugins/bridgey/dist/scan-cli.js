import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// daemon/src/tailscale/config.ts
import { readFileSync, existsSync } from "fs";
var DEFAULTS = {
  bridgey_port: 8092,
  probe_timeout_ms: 2e3,
  exclude_peers: [],
  scan_on_session_start: true
};
function loadConfig(configPath) {
  if (!configPath || !existsSync(configPath)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

// daemon/src/tailscale/scanner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function parseTailscaleStatus(status, excludePeers = []) {
  const peers = [];
  if (!status.Peer) return peers;
  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) continue;
    if (!peer.TailscaleIPs?.length) continue;
    if (excludePeers.includes(peer.HostName)) continue;
    const ipv4 = peer.TailscaleIPs.find((ip) => ip.startsWith("100."));
    if (!ipv4) continue;
    peers.push({ hostname: peer.HostName, tailscale_ip: ipv4, os: peer.OS });
  }
  return peers;
}
async function getTailscaleStatus() {
  const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
  return JSON.parse(stdout);
}
async function probePeer(ip, port, timeoutMs = 2e3) {
  try {
    const healthRes = await fetch(`http://${ip}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!healthRes.ok) return { healthy: false };
    try {
      const cardRes = await fetch(`http://${ip}:${port}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (cardRes.ok) {
        const card = await cardRes.json();
        return { healthy: true, agentCard: card };
      }
    } catch {
    }
    return { healthy: true };
  } catch {
    return { healthy: false };
  }
}
async function scanTailnet(config) {
  const status = await getTailscaleStatus();
  const peers = parseTailscaleStatus(status, config.exclude_peers);
  const discovered = [];
  const results = await Promise.all(
    peers.map(async (peer) => {
      const result = await probePeer(peer.tailscale_ip, config.bridgey_port, config.probe_timeout_ms);
      return { peer, result };
    })
  );
  for (const { peer, result } of results) {
    if (!result.healthy) continue;
    const agentName = result.agentCard?.name ?? `${peer.hostname}-agent`;
    discovered.push({
      ...peer,
      name: agentName,
      url: `http://${peer.tailscale_ip}:${config.bridgey_port}`,
      agent_card: result.agentCard
    });
  }
  return discovered;
}

// daemon/src/tailscale/registrar.ts
import { readFileSync as readFileSync2, writeFileSync, readdirSync, unlinkSync, existsSync as existsSync2, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
var DEFAULT_REGISTRY = join(homedir(), ".bridgey", "agents");
function ensureDir(dir) {
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true });
}
function readEntry(filepath) {
  try {
    return JSON.parse(readFileSync2(filepath, "utf-8"));
  } catch {
    return null;
  }
}
function readLocalDaemon(registryDir = DEFAULT_REGISTRY) {
  ensureDir(registryDir);
  const files = readdirSync(registryDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const entry = readEntry(join(registryDir, file));
    if (!entry || entry.source === "tailscale" || !entry.pid) continue;
    return { name: entry.name, url: entry.url, pid: entry.pid };
  }
  return null;
}
function registerTailnetAgent(agent, registryDir = DEFAULT_REGISTRY) {
  ensureDir(registryDir);
  const entry = {
    name: agent.name,
    url: agent.url,
    pid: null,
    source: "tailscale",
    hostname: agent.hostname,
    tailscale_ip: agent.tailscale_ip,
    discovered_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFileSync(join(registryDir, `${agent.name}.json`), JSON.stringify(entry, null, 2));
}
function removeStaleTailnetAgents(currentPeerNames, registryDir = DEFAULT_REGISTRY) {
  ensureDir(registryDir);
  const removed = [];
  const files = readdirSync(registryDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const entry = readEntry(join(registryDir, file));
    if (!entry || entry.source !== "tailscale") continue;
    if (!currentPeerNames.includes(entry.name)) {
      unlinkSync(join(registryDir, file));
      removed.push(entry.name);
    }
  }
  return removed;
}

// daemon/src/tailscale/scan-cli.ts
async function main() {
  const configPath = process.argv.find((_, i, a) => a[i - 1] === "--config");
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
        tailscale_ip: agent.tailscale_ip
      });
    }
    const removed = removeStaleTailnetAgents(discoveredNames);
    console.log(JSON.stringify({
      status: "ok",
      discovered: discovered.map((a) => ({ name: a.name, hostname: a.hostname, url: a.url })),
      removed
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT") || message.includes("not found")) {
      process.exit(0);
    }
    console.error(JSON.stringify({ status: "error", message }));
    process.exit(1);
  }
}
main();
//# sourceMappingURL=scan-cli.js.map
