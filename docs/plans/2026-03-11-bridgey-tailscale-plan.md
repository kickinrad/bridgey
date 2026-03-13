# bridgey-tailscale Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code plugin that auto-discovers bridgey daemons on the user's Tailscale network and registers them as agents.

**Architecture:** Separate plugin reads `~/.bridgey/agents/` to find the local daemon, runs `tailscale status --json` to find peers, probes each for bridgey, and writes discovered agents back to the file registry. SessionStart hook triggers scan automatically; MCP tool provides on-demand scan.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod` (v3 to match MCP SDK), Node `execFile` (no shell)

**Design doc:** `docs/plans/2026-03-11-bridgey-tailscale-design.md`

---

### Task 1: Scaffold plugin structure

**Files:**
- Create: `bridgey-tailscale/.claude-plugin/plugin.json`
- Create: `bridgey-tailscale/package.json`
- Create: `bridgey-tailscale/tsconfig.json`
- Create: `bridgey-tailscale/CLAUDE.md`

**Step 1: Create plugin directory and manifest**

```bash
mkdir -p bridgey-tailscale/.claude-plugin
```

`bridgey-tailscale/.claude-plugin/plugin.json`:
```json
{
  "name": "bridgey-tailscale",
  "version": "0.1.0",
  "description": "Tailscale mesh network discovery for bridgey. Auto-discovers bridgey agents on your tailnet and registers them — zero manual config.",
  "author": {
    "name": "Wils",
    "email": "wils@bestfootforward.business"
  },
  "repository": "https://github.com/kickinrad/bridgey-tailscale",
  "license": "MIT",
  "keywords": ["bridgey", "tailscale", "discovery", "mesh", "a2a"]
}
```

**Step 2: Create package.json**

`bridgey-tailscale/package.json`:
```json
{
  "name": "bridgey-tailscale",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/scan-cli.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.25.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.1"
  }
}
```

**Step 3: Create tsconfig.json**

`bridgey-tailscale/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

**Step 4: Create CLAUDE.md**

`bridgey-tailscale/CLAUDE.md`:
```markdown
# bridgey-tailscale

Tailscale mesh network discovery expansion pack for bridgey.

## What it does

Scans your Tailscale network for devices running bridgey and auto-registers them as agents. No manual config needed — if a device is on your tailnet and running bridgey, it gets discovered.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `bridgey_tailscale_scan` | Scan tailnet for bridgey agents. Pass optional `force` to re-probe all peers. |

## Skills

| Skill | Trigger |
|-------|---------|
| `/bridgey-tailscale:setup` | First-time config — updates bridgey bind, runs first scan |
| `/bridgey-tailscale:scan` | Manual scan with formatted results |

## Config

Config at `${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json`. Created by `/bridgey-tailscale:setup`.

## Troubleshooting

If scan finds no agents:
1. Check Tailscale is running: `tailscale status`
2. Check bridgey is running on the remote device
3. Check the remote device's bridgey daemon is bound to Tailscale IP (run `/bridgey-tailscale:setup` on that device too)
```

**Step 5: Install dependencies and verify build**

```bash
cd bridgey-tailscale && npm install && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add bridgey-tailscale/
git commit -m "feat(tailscale): scaffold plugin structure"
```

---

### Task 2: Implement registrar module

**Files:**
- Create: `bridgey-tailscale/src/registrar.ts`
- Create: `bridgey-tailscale/src/registrar.test.ts`

The registrar reads/writes `~/.bridgey/agents/` — the same directory bridgey uses for local agent discovery. bridgey-tailscale agents are marked with `"source": "tailscale"` to distinguish them.

**Step 1: Write failing tests**

`bridgey-tailscale/src/registrar.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
  type TailnetAgent,
} from './registrar.js';

describe('registrar', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
  });

  afterEach(() => {
    rmSync(registryDir, { recursive: true, force: true });
  });

  describe('readLocalDaemon', () => {
    it('returns null when no local daemon exists', () => {
      expect(readLocalDaemon(registryDir)).toBeNull();
    });

    it('finds local daemon by pid presence', () => {
      writeFileSync(
        join(registryDir, 'my-agent.json'),
        JSON.stringify({ name: 'my-agent', url: 'http://localhost:8092', pid: process.pid })
      );
      const result = readLocalDaemon(registryDir);
      expect(result).toEqual({ name: 'my-agent', url: 'http://localhost:8092', pid: process.pid });
    });

    it('skips tailscale-sourced entries', () => {
      writeFileSync(
        join(registryDir, 'remote.json'),
        JSON.stringify({ name: 'remote', url: 'http://100.1.2.3:8092', pid: null, source: 'tailscale' })
      );
      expect(readLocalDaemon(registryDir)).toBeNull();
    });
  });

  describe('registerTailnetAgent', () => {
    it('writes agent file with tailscale source marker', () => {
      const agent: TailnetAgent = {
        name: 'mesa-coder',
        url: 'http://100.75.44.106:8092',
        hostname: 'mesa',
        tailscale_ip: '100.75.44.106',
      };
      registerTailnetAgent(agent, registryDir);

      const raw = readFileSync(join(registryDir, 'mesa-coder.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.source).toBe('tailscale');
      expect(parsed.pid).toBeNull();
      expect(parsed.url).toBe('http://100.75.44.106:8092');
      expect(parsed.hostname).toBe('mesa');
    });
  });

  describe('removeStaleTailnetAgents', () => {
    it('removes tailscale agents not in current peer list', () => {
      writeFileSync(
        join(registryDir, 'old-peer.json'),
        JSON.stringify({ name: 'old-peer', url: 'http://100.1.1.1:8092', pid: null, source: 'tailscale' })
      );
      writeFileSync(
        join(registryDir, 'local.json'),
        JSON.stringify({ name: 'local', url: 'http://localhost:8092', pid: process.pid })
      );

      const removed = removeStaleTailnetAgents([], registryDir);
      expect(removed).toEqual(['old-peer']);

      const files = readdirSync(registryDir);
      expect(files).toContain('local.json');
      expect(files).not.toContain('old-peer.json');
    });

    it('keeps tailscale agents still in peer list', () => {
      writeFileSync(
        join(registryDir, 'active-peer.json'),
        JSON.stringify({ name: 'active-peer', url: 'http://100.1.1.1:8092', pid: null, source: 'tailscale' })
      );

      const removed = removeStaleTailnetAgents(['active-peer'], registryDir);
      expect(removed).toEqual([]);
      expect(readdirSync(registryDir)).toContain('active-peer.json');
    });
  });

  describe('listTailnetAgents', () => {
    it('returns only tailscale-sourced agents', () => {
      writeFileSync(
        join(registryDir, 'ts-agent.json'),
        JSON.stringify({ name: 'ts-agent', url: 'http://100.1.1.1:8092', pid: null, source: 'tailscale' })
      );
      writeFileSync(
        join(registryDir, 'local.json'),
        JSON.stringify({ name: 'local', url: 'http://localhost:8092', pid: process.pid })
      );

      const agents = listTailnetAgents(registryDir);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('ts-agent');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd bridgey-tailscale && npx vitest run src/registrar.test.ts
```

Expected: FAIL — module `./registrar.js` not found.

**Step 3: Implement registrar**

`bridgey-tailscale/src/registrar.ts`:
```typescript
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
```

**Step 4: Run tests to verify they pass**

```bash
cd bridgey-tailscale && npx vitest run src/registrar.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add bridgey-tailscale/src/registrar.ts bridgey-tailscale/src/registrar.test.ts
git commit -m "feat(tailscale): implement registrar for ~/.bridgey/agents/"
```

---

### Task 3: Implement scanner module

**Files:**
- Create: `bridgey-tailscale/src/scanner.ts`
- Create: `bridgey-tailscale/src/scanner.test.ts`

The scanner runs `tailscale status --json`, parses peers, probes each for a bridgey daemon, and returns discovered agents. Uses `execFile` (not `exec`) to avoid shell injection.

**Step 1: Write failing tests**

`bridgey-tailscale/src/scanner.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseTailscaleStatus } from './scanner.js';

describe('parseTailscaleStatus', () => {
  it('extracts online peers with tailscale IPs', () => {
    const status = {
      Self: {
        HostName: 'luna',
        TailscaleIPs: ['100.100.100.1'],
        Online: true,
        OS: 'linux',
      },
      Peer: {
        'nodekey:abc': {
          HostName: 'mesa',
          TailscaleIPs: ['100.75.44.106', 'fd7a:115c:a1e0::1'],
          Online: true,
          OS: 'linux',
        },
        'nodekey:def': {
          HostName: 'cloud',
          TailscaleIPs: ['100.105.101.128'],
          Online: false,
          OS: 'linux',
        },
        'nodekey:ghi': {
          HostName: 'yoga',
          TailscaleIPs: ['100.123.160.51'],
          Online: true,
          OS: 'windows',
        },
      },
    };

    const peers = parseTailscaleStatus(status);
    expect(peers).toHaveLength(2);
    expect(peers[0].hostname).toBe('mesa');
    expect(peers[0].tailscale_ip).toBe('100.75.44.106');
    expect(peers[1].hostname).toBe('yoga');
  });

  it('excludes self from peer list', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
      Peer: {},
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('handles missing Peer key gracefully', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('filters excluded hostnames', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.1.1.1'], Online: true, OS: 'linux' },
      Peer: {
        'nodekey:a': { HostName: 'mesa', TailscaleIPs: ['100.2.2.2'], Online: true, OS: 'linux' },
        'nodekey:b': { HostName: 'printer', TailscaleIPs: ['100.3.3.3'], Online: true, OS: 'linux' },
      },
    };

    const peers = parseTailscaleStatus(status, ['printer']);
    expect(peers).toHaveLength(1);
    expect(peers[0].hostname).toBe('mesa');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd bridgey-tailscale && npx vitest run src/scanner.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement scanner**

`bridgey-tailscale/src/scanner.ts`:
```typescript
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
```

**Step 4: Run tests**

```bash
cd bridgey-tailscale && npx vitest run src/scanner.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add bridgey-tailscale/src/scanner.ts bridgey-tailscale/src/scanner.test.ts
git commit -m "feat(tailscale): implement scanner with tailscale status parsing and peer probing"
```

---

### Task 4: Implement scan CLI entry point

**Files:**
- Create: `bridgey-tailscale/src/config.ts`
- Create: `bridgey-tailscale/src/scan-cli.ts`

This is the entry point for the SessionStart hook. Reads config, runs scan, registers agents, outputs summary JSON.

**Step 1: Implement config loader**

`bridgey-tailscale/src/config.ts`:
```typescript
import { readFileSync, existsSync } from 'fs';

export type BridgeyTailscaleConfig = {
  bridgey_port: number;
  probe_timeout_ms: number;
  exclude_peers: string[];
  scan_on_session_start: boolean;
};

const DEFAULTS: BridgeyTailscaleConfig = {
  bridgey_port: 8092,
  probe_timeout_ms: 2000,
  exclude_peers: [],
  scan_on_session_start: true,
};

export function loadConfig(configPath?: string): BridgeyTailscaleConfig {
  if (!configPath || !existsSync(configPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}
```

**Step 2: Implement scan CLI**

`bridgey-tailscale/src/scan-cli.ts`:
```typescript
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
```

**Step 3: Verify build**

```bash
cd bridgey-tailscale && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add bridgey-tailscale/src/config.ts bridgey-tailscale/src/scan-cli.ts
git commit -m "feat(tailscale): add config loader and scan CLI entry point"
```

---

### Task 5: Implement MCP server

**Files:**
- Create: `bridgey-tailscale/src/server.ts`
- Create: `bridgey-tailscale/.mcp.json`

**Step 1: Implement MCP server**

`bridgey-tailscale/src/server.ts`:
```typescript
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
```

**Step 2: Create MCP config**

`bridgey-tailscale/.mcp.json`:
```json
{
  "mcpServers": {
    "bridgey-tailscale": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      "env": {}
    }
  }
}
```

**Step 3: Build and verify**

```bash
cd bridgey-tailscale && npx tsc
```

Expected: Clean build, `dist/server.js` exists.

**Step 4: Commit**

```bash
git add bridgey-tailscale/src/server.ts bridgey-tailscale/.mcp.json
git commit -m "feat(tailscale): add MCP server with bridgey_tailscale_scan tool"
```

---

### Task 6: Add hooks and skills

**Files:**
- Create: `bridgey-tailscale/hooks/hooks.json`
- Create: `bridgey-tailscale/skills/setup.md`
- Create: `bridgey-tailscale/skills/scan.md`

**Step 1: Create SessionStart hook**

`bridgey-tailscale/hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scan-cli.js --config ${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json",
            "timeout": 15000
          }
        ]
      }
    ]
  }
}
```

**Step 2: Create setup skill**

`bridgey-tailscale/skills/setup.md`:
```markdown
---
name: setup
description: "First-time bridgey-tailscale configuration. Updates bridgey daemon binding for tailnet access and runs initial peer scan."
user_invocable: true
---

# bridgey-tailscale Setup

Configure bridgey for Tailscale mesh network discovery.

## Steps

1. **Check Tailscale is running:**
   Run `tailscale status` via Bash. If it fails, tell the user to install Tailscale (https://tailscale.com/download) or run `tailscale up`.

2. **Find bridgey config:**
   Look for bridgey's config at `~/.bridgey/bridgey.config.json` or check the bridgey plugin's `bridgey.config.json`. If not found, tell the user to run `/bridgey:setup` first.

3. **Update bridgey daemon binding:**
   Read the bridgey config file. Update two fields:
   - Set `bind` to `"0.0.0.0"`
   - Add `"trusted_networks": ["100.64.0.0/10"]`
   Write the updated config back. Explain to the user: "This binds your bridgey daemon to all interfaces but only accepts connections from localhost and Tailscale IPs (100.64.0.0/10). Your daemon won't be exposed to the general LAN."

4. **Restart bridgey daemon:**
   Stop and start the daemon:
   ```bash
   node <bridgey-plugin-root>/daemon/dist/index.js stop --pidfile /tmp/bridgey-${USER}.pid
   node <bridgey-plugin-root>/daemon/dist/watchdog.js --config <config-path> --pidfile /tmp/bridgey-${USER}.pid
   ```

5. **Write bridgey-tailscale config:**
   Create `${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json` with defaults:
   ```json
   {
     "bridgey_port": <port from bridgey config>,
     "probe_timeout_ms": 2000,
     "exclude_peers": [],
     "scan_on_session_start": true
   }
   ```

6. **Run first scan:**
   Use the `bridgey_tailscale_scan` MCP tool to discover peers. Display the results.

7. **Remind the user:** Other devices on the tailnet also need bridgey-tailscale setup to be discoverable. Share the plugin link or tell them to run `/bridgey-tailscale:setup` on each device.
```

**Step 3: Create scan skill**

`bridgey-tailscale/skills/scan.md`:
```markdown
---
name: scan
description: "Manually scan the Tailscale network for bridgey agents. Shows discovered, new, and removed agents."
user_invocable: true
---

# bridgey-tailscale Scan

Scan your tailnet for bridgey agents.

## Steps

1. Use the `bridgey_tailscale_scan` MCP tool with `force: true` to re-probe all peers.
2. Display the results to the user in a readable format.
3. If no agents found, suggest:
   - Check that other devices have bridgey running and configured with `/bridgey-tailscale:setup`
   - Check `tailscale status` to verify devices are online
   - Check if any peers are in `exclude_peers` config
```

**Step 4: Commit**

```bash
git add bridgey-tailscale/hooks/ bridgey-tailscale/skills/
git commit -m "feat(tailscale): add SessionStart hook and setup/scan skills"
```

---

### Task 7: Update bridgey core — trusted networks auth

**Files:**
- Modify: `daemon/src/auth.ts`
- Create or modify: daemon auth test file

This is one of two bridgey core changes — add CIDR-based trusted network support to auth.

**Step 1: Write failing tests**

Add to daemon test suite:
```typescript
import { describe, it, expect } from 'vitest';
import { isInCIDR, isTrustedNetwork } from './auth.js';

describe('isInCIDR', () => {
  it('matches IP within Tailscale CGNAT range', () => {
    expect(isInCIDR('100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('100.127.255.255', '100.64.0.0/10')).toBe(true);
  });

  it('rejects IP outside CIDR range', () => {
    expect(isInCIDR('192.168.1.1', '100.64.0.0/10')).toBe(false);
    expect(isInCIDR('10.0.0.1', '100.64.0.0/10')).toBe(false);
  });

  it('handles IPv4-mapped IPv6 addresses', () => {
    expect(isInCIDR('::ffff:100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('::ffff:192.168.1.1', '100.64.0.0/10')).toBe(false);
  });
});

describe('isTrustedNetwork', () => {
  it('returns false when no trusted networks configured', () => {
    expect(isTrustedNetwork('100.75.44.106', [])).toBe(false);
    expect(isTrustedNetwork('100.75.44.106', undefined)).toBe(false);
  });

  it('returns true when IP matches a trusted network', () => {
    expect(isTrustedNetwork('100.75.44.106', ['100.64.0.0/10'])).toBe(true);
  });

  it('checks multiple CIDRs', () => {
    expect(isTrustedNetwork('10.0.0.5', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(true);
    expect(isTrustedNetwork('172.16.0.1', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd daemon && npx vitest run
```

Expected: FAIL — `isInCIDR` and `isTrustedNetwork` not exported from auth.

**Step 3: Implement CIDR utilities**

Add to `daemon/src/auth.ts`:

```typescript
function ipToLong(ip: string): number {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.');
  if (parts.length !== 4) return 0;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

export function isInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(network) & mask);
}

export function isTrustedNetwork(ip: string, trustedNetworks?: string[]): boolean {
  if (!trustedNetworks?.length) return false;
  return trustedNetworks.some((cidr) => isInCIDR(ip, cidr));
}
```

Then update the auth check where `isLocalAgent` is used to also accept trusted networks:

```typescript
// In the route auth — where isLocalAgent(req) is checked:
if (isLocalAgent(req) || isTrustedNetwork(req.ip, config.trusted_networks)) {
  // skip bearer token
}
```

**Step 4: Run tests**

```bash
cd daemon && npx vitest run
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add daemon/src/auth.ts daemon/src/auth.test.ts
git commit -m "feat(daemon): add trusted_networks CIDR auth for tailnet peers"
```

---

### Task 8: Update bridgey core — IP allowlist for 0.0.0.0 bind

**Files:**
- Modify: `daemon/src/index.ts` (Fastify listen setup)

**Step 1: Find the Fastify listen call in index.ts**

Read `daemon/src/index.ts` and locate where `fastify.listen()` is called and where the bind address is resolved.

**Step 2: Add IP allowlist onRequest hook**

Add before `listen()`:

```typescript
import { isTrustedNetwork } from './auth.js';

// When binding broadly, enforce IP allowlist
if (bindAddress === '0.0.0.0') {
  app.addHook('onRequest', (req, reply, done) => {
    const ip = req.ip;
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
    const isTrusted = isTrustedNetwork(ip, config.trusted_networks);

    if (!isLoopback && !isTrusted) {
      reply.code(403).send({ error: 'Forbidden: untrusted source IP' });
      return;
    }
    done();
  });
}
```

**Step 3: Build and run tests**

```bash
cd daemon && npx tsc && npx vitest run
```

Expected: Clean build, all tests pass.

**Step 4: Commit**

```bash
git add daemon/src/index.ts
git commit -m "security(daemon): add IP allowlist when bound to 0.0.0.0"
```

---

### Task 9: Integration test — full scan flow

**Files:**
- Create: `bridgey-tailscale/src/scan-flow.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTailscaleStatus } from './scanner.js';
import {
  registerTailnetAgent,
  removeStaleTailnetAgents,
  readLocalDaemon,
  listTailnetAgents,
} from './registrar.js';

describe('scan flow integration', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = mkdtempSync(join(tmpdir(), 'bridgey-scan-test-'));
  });

  afterEach(() => {
    rmSync(registryDir, { recursive: true, force: true });
  });

  it('full discovery -> register -> cleanup cycle', () => {
    // Local daemon exists
    writeFileSync(
      join(registryDir, 'local.json'),
      JSON.stringify({ name: 'local', url: 'http://localhost:8092', pid: process.pid })
    );

    // Stale tailscale agent from previous scan
    writeFileSync(
      join(registryDir, 'old-peer.json'),
      JSON.stringify({ name: 'old-peer', url: 'http://100.1.1.1:8092', pid: null, source: 'tailscale' })
    );

    // Verify local daemon found
    const local = readLocalDaemon(registryDir);
    expect(local).not.toBeNull();
    expect(local!.name).toBe('local');

    // Parse tailscale status
    const peers = parseTailscaleStatus({
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
      Peer: {
        'nodekey:abc': { HostName: 'mesa', TailscaleIPs: ['100.75.44.106'], Online: true, OS: 'linux' },
      },
    });
    expect(peers).toHaveLength(1);

    // Register discovered agent
    registerTailnetAgent(
      { name: 'mesa-agent', url: 'http://100.75.44.106:8092', hostname: 'mesa', tailscale_ip: '100.75.44.106' },
      registryDir
    );

    // Cleanup stale
    const removed = removeStaleTailnetAgents(['mesa-agent'], registryDir);
    expect(removed).toEqual(['old-peer']);

    // Final state
    const agents = listTailnetAgents(registryDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('mesa-agent');

    const files = readdirSync(registryDir);
    expect(files).toContain('local.json');
    expect(files).toContain('mesa-agent.json');
    expect(files).not.toContain('old-peer.json');
  });
});
```

**Step 2: Run all plugin tests**

```bash
cd bridgey-tailscale && npx vitest run
```

Expected: All PASS.

**Step 3: Commit**

```bash
git add bridgey-tailscale/src/scan-flow.test.ts
git commit -m "test(tailscale): add integration test for full scan flow"
```

---

### Task 10: Final build, validate, and clean up

**Step 1: Full build of both projects**

```bash
cd bridgey-tailscale && npm run build
cd ../daemon && npm run build
```

Expected: Clean builds.

**Step 2: Run all tests**

```bash
cd bridgey-tailscale && npm test
cd ../daemon && npm test
```

Expected: All pass in both.

**Step 3: Validate plugin structure**

Use plugin-validator agent to check `bridgey-tailscale/` has correct Claude Code plugin structure.

**Step 4: Update phases.md**

Mark bridgey-tailscale checklist items as complete in `docs/phases.md`.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(tailscale): complete bridgey-tailscale expansion pack v0.1.0 ✧(≖ ◡ ≖✿)"
```
