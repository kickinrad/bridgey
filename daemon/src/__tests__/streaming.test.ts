import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { initDB, closeDB } from '../db.js';
import type { BridgeyConfig } from '../types.js';

// Mock executor to yield streaming chunks
vi.mock('../executor.js', () => ({
  executePrompt: vi.fn().mockResolvedValue('Mock response'),
  executePromptStreaming: vi.fn().mockImplementation(async function* () {
    yield 'chunk1';
    yield 'chunk2';
    yield 'chunk3';
  }),
}));

const { a2aRoutes } = await import('../a2a-server.js');

const TEST_PORT = 18096;

const testConfig: BridgeyConfig = {
  name: 'stream-test',
  description: 'Streaming test agent',
  port: TEST_PORT,
  bind: 'localhost',
  token: 'brg_streamtest',
  workspace: '/tmp',
  max_turns: 1,
  agents: [],
};

describe('message/sendStream SSE', () => {
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

  it('returns SSE stream with chunks', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_streamtest',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'stream-1',
        method: 'message/sendStream',
        params: {
          message: { role: 'user', parts: [{ text: 'Hello streaming!' }] },
          agentName: 'test-sender',
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const text = await res.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data: '));

    // Should have chunk events + final end event
    expect(events.length).toBeGreaterThanOrEqual(4); // 3 chunks + 1 end

    // Parse first chunk event
    const firstEvent = JSON.parse(events[0].replace('data: ', ''));
    expect(firstEvent.result.type).toBe('message/stream');
    expect(firstEvent.result.message.parts[0].text).toBe('chunk1');

    // Parse last event (end)
    const lastEvent = JSON.parse(events[events.length - 1].replace('data: ', ''));
    expect(lastEvent.result.type).toBe('message/stream/end');
    expect(lastEvent.result.message.parts[0].text).toBe('chunk1chunk2chunk3');
  });

  it('validates params for sendStream', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_streamtest',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'stream-2',
        method: 'message/sendStream',
        params: {
          message: { parts: [] },
        },
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  });

  it('agent card shows streaming capability', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/.well-known/agent-card.json`);
    const card = await res.json() as { capabilities: { streaming: boolean } };
    expect(card.capabilities.streaming).toBe(true);
  });
});
