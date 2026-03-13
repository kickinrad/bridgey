import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type LocalAgent = {
  name: string;
  url: string;
  pid: number;
};

export type TailnetAgent = {
  name: string;
  url: string;
  hostname: string;
  tailscale_ip: string;
};

type RegistryEntry = {
  name: string;
  url: string;
  pid: number | null;
  source?: string;
  hostname?: string;
  tailscale_ip?: string;
  discovered_at?: string;
};

const DEFAULT_REGISTRY = join(homedir(), '.bridgey', 'agents');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readEntry(filepath: string): RegistryEntry | null {
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  } catch {
    return null;
  }
}

export function readLocalDaemon(registryDir = DEFAULT_REGISTRY): LocalAgent | null {
  ensureDir(registryDir);
  const files = readdirSync(registryDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const entry = readEntry(join(registryDir, file));
    if (!entry || entry.source === 'tailscale' || !entry.pid) continue;
    return { name: entry.name, url: entry.url, pid: entry.pid };
  }
  return null;
}

export function registerTailnetAgent(agent: TailnetAgent, registryDir = DEFAULT_REGISTRY): void {
  ensureDir(registryDir);
  const entry: RegistryEntry = {
    name: agent.name,
    url: agent.url,
    pid: null,
    source: 'tailscale',
    hostname: agent.hostname,
    tailscale_ip: agent.tailscale_ip,
    discovered_at: new Date().toISOString(),
  };
  writeFileSync(join(registryDir, `${agent.name}.json`), JSON.stringify(entry, null, 2));
}

export function removeStaleTailnetAgents(
  currentPeerNames: string[],
  registryDir = DEFAULT_REGISTRY
): string[] {
  ensureDir(registryDir);
  const removed: string[] = [];
  const files = readdirSync(registryDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const entry = readEntry(join(registryDir, file));
    if (!entry || entry.source !== 'tailscale') continue;
    if (!currentPeerNames.includes(entry.name)) {
      unlinkSync(join(registryDir, file));
      removed.push(entry.name);
    }
  }
  return removed;
}

export function listTailnetAgents(registryDir = DEFAULT_REGISTRY): RegistryEntry[] {
  ensureDir(registryDir);
  const files = readdirSync(registryDir).filter((f) => f.endsWith('.json'));
  const agents: RegistryEntry[] = [];

  for (const file of files) {
    const entry = readEntry(join(registryDir, file));
    if (entry?.source === 'tailscale') agents.push(entry);
  }
  return agents;
}
