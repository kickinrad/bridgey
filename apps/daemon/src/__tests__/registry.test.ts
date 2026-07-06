import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// vi.hoisted runs before vi.mock hoisting — tempDir is available when the mock factory executes
const { tempDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');
  return { tempDir: mkdtempSync(join(tmpdir(), 'bridgey-registry-test-')) as string };
});

// Must mock before importing registry — vi.mock is hoisted
vi.mock('os', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('os');
  return { ...original, homedir: () => tempDir };
});

import { register, unregister, listLocal } from '../registry.js';
import type { LocalAgent } from '../types.js';

const REGISTRY_DIR = join(tempDir, '.bridgey', 'agents');

function makeAgent(overrides: Partial<LocalAgent> = {}): LocalAgent {
  return {
    name: 'test-agent',
    url: 'http://localhost:9000',
    pid: process.pid,
    ...overrides,
  };
}

describe('registry', () => {
  beforeEach(() => {
    // Clean the registry directory between tests
    if (existsSync(REGISTRY_DIR)) {
      for (const file of readdirSync(REGISTRY_DIR)) {
        rmSync(join(REGISTRY_DIR, file));
      }
    }
  });

  afterAll(() => {
    // Remove the entire temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('register() writes a JSON file to the registry directory', () => {
    const agent = makeAgent();
    register(agent);

    const filePath = join(REGISTRY_DIR, `${agent.name}.json`);
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toEqual(agent);
  });

  it('unregister() removes the agent JSON file', () => {
    const agent = makeAgent();
    register(agent);

    const filePath = join(REGISTRY_DIR, `${agent.name}.json`);
    expect(existsSync(filePath)).toBe(true);

    unregister(agent.name);
    expect(existsSync(filePath)).toBe(false);
  });

  it('unregister() does not throw for non-existent agent', () => {
    expect(() => unregister('does-not-exist')).not.toThrow();
  });

  it('listLocal() returns all registered agents with alive PIDs', () => {
    const agent1 = makeAgent({ name: 'alive-1', pid: process.pid });
    const agent2 = makeAgent({ name: 'alive-2', pid: process.pid });
    register(agent1);
    register(agent2);

    const result = listLocal();
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name).sort()).toEqual(['alive-1', 'alive-2']);
  });

  it('listLocal() removes stale agents with dead PIDs', () => {
    const alive = makeAgent({ name: 'alive-agent', pid: process.pid });
    const stale = makeAgent({ name: 'stale-agent', pid: 999999 });
    register(alive);
    register(stale);

    const result = listLocal();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('alive-agent');

    // Stale agent's file should have been cleaned up
    const staleFile = join(REGISTRY_DIR, 'stale-agent.json');
    expect(existsSync(staleFile)).toBe(false);
  });

  it('listLocal() returns empty array when no agents registered', () => {
    const result = listLocal();
    expect(result).toEqual([]);
  });

  it('register() creates the registry directory if it does not exist', () => {
    // Remove the directory entirely
    rmSync(REGISTRY_DIR, { recursive: true, force: true });
    expect(existsSync(REGISTRY_DIR)).toBe(false);

    const agent = makeAgent();
    register(agent);

    expect(existsSync(REGISTRY_DIR)).toBe(true);
    const filePath = join(REGISTRY_DIR, `${agent.name}.json`);
    expect(existsSync(filePath)).toBe(true);
  });
});
