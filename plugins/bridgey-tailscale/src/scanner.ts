import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TailscalePeer = {
  hostname: string;
  tailscale_ip: string;
  os: string;
};

export type DiscoveredAgent = TailscalePeer & {
  name: string;
  url: string;
  agent_card?: Record<string, unknown>;
};

type TailscaleStatus = {
  Self: { HostName: string; TailscaleIPs: string[]; Online: boolean; OS: string };
  Peer?: Record<string, { HostName: string; TailscaleIPs: string[]; Online: boolean; OS: string }>;
};

export function parseTailscaleStatus(
  status: TailscaleStatus,
  excludePeers: string[] = []
): TailscalePeer[] {
  const peers: TailscalePeer[] = [];
  if (!status.Peer) return peers;

  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) continue;
    if (!peer.TailscaleIPs?.length) continue;
    if (excludePeers.includes(peer.HostName)) continue;

    const ipv4 = peer.TailscaleIPs.find((ip) => ip.startsWith('100.'));
    if (!ipv4) continue;

    peers.push({ hostname: peer.HostName, tailscale_ip: ipv4, os: peer.OS });
  }

  return peers;
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const { stdout } = await execFileAsync('tailscale', ['status', '--json']);
  return JSON.parse(stdout);
}

export async function probePeer(
  ip: string,
  port: number,
  timeoutMs = 2000
): Promise<{ healthy: boolean; agentCard?: Record<string, unknown> }> {
  try {
    const healthRes = await fetch(`http://${ip}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!healthRes.ok) return { healthy: false };

    try {
      const cardRes = await fetch(`http://${ip}:${port}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (cardRes.ok) {
        const card = await cardRes.json();
        return { healthy: true, agentCard: card as Record<string, unknown> };
      }
    } catch {
      // Agent card is optional
    }

    return { healthy: true };
  } catch {
    return { healthy: false };
  }
}

export type ScanConfig = {
  bridgey_port: number;
  probe_timeout_ms: number;
  exclude_peers: string[];
};

export async function scanTailnet(config: ScanConfig): Promise<DiscoveredAgent[]> {
  const status = await getTailscaleStatus();
  const peers = parseTailscaleStatus(status, config.exclude_peers);
  const discovered: DiscoveredAgent[] = [];

  const results = await Promise.all(
    peers.map(async (peer) => {
      const result = await probePeer(peer.tailscale_ip, config.bridgey_port, config.probe_timeout_ms);
      return { peer, result };
    })
  );

  for (const { peer, result } of results) {
    if (!result.healthy) continue;

    const agentName =
      (result.agentCard as Record<string, string> | undefined)?.name ?? `${peer.hostname}-agent`;

    discovered.push({
      ...peer,
      name: agentName,
      url: `http://${peer.tailscale_ip}:${config.bridgey_port}`,
      agent_card: result.agentCard,
    });
  }

  return discovered;
}
