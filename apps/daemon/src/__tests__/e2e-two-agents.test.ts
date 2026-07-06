import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Fastify from 'fastify';
import { Store } from '../store.js';
import { register, unregister } from '../registry.js';
import type { BridgeyConfig } from '../types.js';

// Mock executor to avoid spawning real claude -p in tests
vi.mock('../executor.js', () => ({
  executePrompt: vi.fn().mockResolvedValue('Mock response from claude'),
}));

// Import after mock setup
const { a2aRoutes } = await import('../a2a-server.js');

const PORT_A = 18094;
const PORT_B = 18095;

const configA: BridgeyConfig = {
  name: 'agent-a',
  description: 'Test agent A',
  port: PORT_A,
  bind: 'localhost',
  token: 'brg_agenta_token',
  workspace: '/tmp',
  max_turns: 1,
  agents: [{ name: 'agent-b', url: `http://localhost:${PORT_B}`, token: 'brg_agentb_token' }],
};

const configB: BridgeyConfig = {
  name: 'agent-b',
  description: 'Test agent B',
  port: PORT_B,
  bind: 'localhost',
  token: 'brg_agentb_token',
  workspace: '/tmp',
  max_turns: 1,
  agents: [{ name: 'agent-a', url: `http://localhost:${PORT_A}`, token: 'brg_agenta_token' }],
};

describe('e2e: two agents communicate', () => {
  let serverA: ReturnType<typeof Fastify>;
  let serverB: ReturnType<typeof Fastify>;
  let dirA: string;
  let dirB: string;

  beforeAll(async () => {
    dirA = mkdtempSync(join(tmpdir(), 'bridgey-test-a-'));
    dirB = mkdtempSync(join(tmpdir(), 'bridgey-test-b-'));
    const storeA = new Store(dirA);
    const storeB = new Store(dirB);

    serverA = Fastify({ logger: false });
    serverB = Fastify({ logger: false });

    a2aRoutes(serverA, configA, storeA);
    a2aRoutes(serverB, configB, storeB);

    await serverA.listen({ port: PORT_A, host: '127.0.0.1' });
    await serverB.listen({ port: PORT_B, host: '127.0.0.1' });

    register({ name: 'agent-a', url: `http://127.0.0.1:${PORT_A}`, pid: process.pid });
    register({ name: 'agent-b', url: `http://127.0.0.1:${PORT_B}`, pid: process.pid });
  });

  afterAll(async () => {
    unregister('agent-a');
    unregister('agent-b');
    await serverA.close();
    await serverB.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it('agent-a can discover agent-b via agent card', async () => {
    const res = await fetch(`http://localhost:${PORT_B}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = await res.json() as { name: string };
    expect(card.name).toBe('agent-b');
  });

  it('agent-a can send A2A JSON-RPC message to agent-b', async () => {
    const res = await fetch(`http://localhost:${PORT_B}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_agentb_token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'message/send',
        params: {
          message: { role: 'user', parts: [{ text: 'Hello from agent-a!' }] },
          agentName: 'agent-a',
        },
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { jsonrpc: string; id: string; result?: unknown; error?: unknown };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('test-1');
    expect(body.result || body.error).toBeTruthy();
  });

  it('agent-a can list agents via /agents on agent-b', async () => {
    const res = await fetch(`http://localhost:${PORT_B}/agents`, {
      headers: { Authorization: 'Bearer brg_agentb_token' },
    });
    expect(res.ok).toBe(true);
    const agents = await res.json() as Array<{ name: string }>;
    expect(Array.isArray(agents)).toBe(true);
  });

  it('agent-a /send to agent-b routes through A2A', async () => {
    const res = await fetch(`http://localhost:${PORT_A}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_agenta_token',
      },
      body: JSON.stringify({
        agent: 'agent-b',
        message: 'Hello via /send!',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { response: string };
    expect(body.response).toBeDefined();
    expect(typeof body.response).toBe('string');
  });
});
