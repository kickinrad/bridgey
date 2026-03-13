import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { a2aRoutes } from '../a2a-server.js';
import { initDB, closeDB } from '../db.js';
import type { BridgeyConfig } from '../types.js';

const TEST_PORT = 18093;

const testConfig: BridgeyConfig = {
  name: 'test-agent',
  description: 'Test agent',
  port: TEST_PORT,
  bind: 'localhost',
  token: 'brg_testtoken123',
  workspace: '/tmp',
  max_turns: 1,
  agents: [],
};

describe('a2a-server endpoints', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    initDB();
    fastify = Fastify({ logger: false });
    a2aRoutes(fastify, testConfig);
    await fastify.listen({ port: TEST_PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
    closeDB();
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /.well-known/agent-card.json returns agent card', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = await res.json() as { name: string; version: string };
    expect(card.name).toBe('test-agent');
    expect(card.version).toBe('0.2.0');
  });

  it('GET /agents without auth returns 401 or 200 (localhost trusted)', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/agents`);
    // Localhost requests are trusted when local agents are registered in ~/.bridgey/agents/
    // So this returns 200 if agents exist, 401 if not
    expect([200, 401]).toContain(res.status);
  });

  it('GET /agents with valid token returns list', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/agents`, {
      headers: { Authorization: 'Bearer brg_testtoken123' },
    });
    expect(res.ok).toBe(true);
    const agents = await res.json();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('POST /send without body returns 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST / with invalid JSON-RPC returns 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({ not: 'jsonrpc' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown agent on /send', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({ agent: 'nonexistent', message: 'hello' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('nonexistent');
  });
});
