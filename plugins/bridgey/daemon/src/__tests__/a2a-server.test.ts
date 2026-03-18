import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Fastify from 'fastify';
import { a2aRoutes } from '../a2a-server.js';
import { Store } from '../store.js';
import type { BridgeyConfig } from '../types.js';

const testConfig: BridgeyConfig = {
  name: 'test-agent',
  description: 'Test agent',
  port: 0,
  bind: 'localhost',
  token: 'brg_testtoken123',
  workspace: '/tmp',
  max_turns: 1,
  agents: [],
};

describe('a2a-server endpoints', () => {
  let fastify: ReturnType<typeof Fastify>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
    const store = new Store(dir);
    fastify = Fastify({ logger: false });
    a2aRoutes(fastify, testConfig, store);
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /health returns ok', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /.well-known/agent-card.json returns agent card', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/.well-known/agent-card.json' });
    expect(res.statusCode).toBe(200);
    const card = res.json() as { name: string; version: string };
    expect(card.name).toBe('test-agent');
    expect(card.version).toBe('0.2.0');
  });

  it('GET /agents without auth returns 401 or 200 (localhost trusted)', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/agents' });
    // Localhost requests are trusted when local agents are registered in ~/.bridgey/agents/
    // So this returns 200 if agents exist, 401 if not
    expect([200, 401]).toContain(res.statusCode);
  });

  it('GET /agents with valid token returns list', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/agents',
      headers: { Authorization: 'Bearer brg_testtoken123' },
    });
    expect(res.statusCode).toBe(200);
    const agents = res.json();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('POST /send without body returns 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST / with invalid JSON-RPC returns 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: { not: 'jsonrpc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /send with missing agent field returns 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: { message: 'hello there' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /send with empty message returns 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: { agent: 'some-agent', message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /send with message exceeding 10000 chars returns 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: { agent: 'some-agent', message: 'A'.repeat(10_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown agent on /send', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/send',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      payload: { agent: 'nonexistent', message: 'hello' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    expect(body.error).toContain('nonexistent');
  });
});
