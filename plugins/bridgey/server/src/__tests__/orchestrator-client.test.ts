import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { OrchestratorClient } from '../orchestrator-client.js';
import type { AgentConfig } from '../types.js';

const MILA_URL = 'http://mila.example:8093';
const BOB_URL = 'http://bob.example:8094';
const TOKEN = 'brg_test-token';

const agents: AgentConfig[] = [
  { name: 'mila', url: MILA_URL, token: TOKEN },
  { name: 'bob', url: BOB_URL, token: TOKEN },
];

function a2aSuccess(text: string) {
  return {
    jsonrpc: '2.0',
    id: 'ignored',
    result: { message: { role: 'agent', parts: [{ text }] } },
  };
}

function a2aError(code: number, message: string) {
  return {
    jsonrpc: '2.0',
    id: 'ignored',
    error: { code, message },
  };
}

const mockServer = setupServer();
beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe('OrchestratorClient', () => {
  describe('send', () => {
    it('returns response text from a successful A2A call', async () => {
      mockServer.use(
        http.post(MILA_URL, () => HttpResponse.json(a2aSuccess('Hello from Mila!'))),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.send('mila', 'Hey Mila');

      expect(result).toEqual({ response: 'Hello from Mila!' });
    });

    it('includes agentName in the JSON-RPC params', async () => {
      let capturedBody: any = null;
      mockServer.use(
        http.post(MILA_URL, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(a2aSuccess('ok'));
        }),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      await client.send('mila', 'test');

      expect(capturedBody.params.agentName).toBe('claude-ai');
    });

    it('includes contextId when provided', async () => {
      let capturedBody: any = null;
      mockServer.use(
        http.post(MILA_URL, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(a2aSuccess('ok'));
        }),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      await client.send('mila', 'test', 'ctx-123');

      expect(capturedBody.params.contextId).toBe('ctx-123');
    });

    it('sends Authorization Bearer header', async () => {
      let capturedAuth: string | null = null;
      mockServer.use(
        http.post(MILA_URL, ({ request }) => {
          capturedAuth = request.headers.get('Authorization');
          return HttpResponse.json(a2aSuccess('ok'));
        }),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      await client.send('mila', 'test');

      expect(capturedAuth).toBe(`Bearer ${TOKEN}`);
    });

    it('returns error for unknown agent', async () => {
      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.send('nara', 'hello');

      expect(result.error).toContain('Unknown agent "nara"');
      expect(result.error).toContain('mila');
      expect(result.error).toContain('bob');
    });

    it('returns error on A2A error response', async () => {
      mockServer.use(
        http.post(MILA_URL, () => HttpResponse.json(a2aError(-32000, 'Agent busy'))),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.send('mila', 'test');

      expect(result.error).toContain('A2A error');
      expect(result.error).toContain('Agent busy');
    });

    it('returns error on HTTP failure', async () => {
      mockServer.use(
        http.post(MILA_URL, () => new HttpResponse('Unauthorized', { status: 401 })),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.send('mila', 'test');

      expect(result.error).toContain('401');
    });

    it('logs messages to in-memory history', async () => {
      mockServer.use(
        http.post(MILA_URL, () => HttpResponse.json(a2aSuccess('response text'))),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      await client.send('mila', 'hello');

      const messages = await client.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].direction).toBe('outbound');
      expect(messages[0].agent_name).toBe('mila');
      expect(messages[0].message).toBe('hello');
      expect(messages[0].response).toBe('response text');
    });
  });

  describe('listAgents', () => {
    it('returns online/offline status based on health pings', async () => {
      mockServer.use(
        http.get(`${MILA_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
        http.get(`${BOB_URL}/health`, () => HttpResponse.error()),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.listAgents();

      expect(result).toHaveLength(2);
      const mila = result.find((a) => a.name === 'mila');
      const bob = result.find((a) => a.name === 'bob');
      expect(mila?.status).toBe('online');
      expect(bob?.status).toBe('offline');
    });

    it('sets source to config for all agents', async () => {
      mockServer.use(
        http.get(`${MILA_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
        http.get(`${BOB_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      const result = await client.listAgents();

      for (const agent of result) {
        expect(agent.source).toBe('config');
      }
    });
  });

  describe('getMessages', () => {
    it('returns empty array when no messages', async () => {
      const client = new OrchestratorClient('claude-ai', agents);
      const messages = await client.getMessages();
      expect(messages).toEqual([]);
    });

    it('respects limit parameter', async () => {
      mockServer.use(
        http.post(MILA_URL, () => HttpResponse.json(a2aSuccess('r1'))),
        http.post(BOB_URL, () => HttpResponse.json(a2aSuccess('r2'))),
      );

      const client = new OrchestratorClient('claude-ai', agents);
      await client.send('mila', 'm1');

      mockServer.use(
        http.post(BOB_URL, () => HttpResponse.json(a2aSuccess('r2'))),
      );
      await client.send('bob', 'm2');

      const limited = await client.getMessages(1);
      expect(limited).toHaveLength(1);
      expect(limited[0].agent_name).toBe('bob'); // most recent first
    });
  });

  describe('health', () => {
    it('returns orchestrator status with agent name', async () => {
      const client = new OrchestratorClient('claude-ai', agents);
      const health = await client.health();

      expect(health.status).toBe('ok (orchestrator)');
      expect(health.name).toBe('claude-ai');
    });
  });
});
