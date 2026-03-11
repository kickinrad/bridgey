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
