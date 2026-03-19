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
} from '../../tailscale/registrar.js';

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
