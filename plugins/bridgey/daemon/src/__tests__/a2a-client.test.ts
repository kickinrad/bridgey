import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { sendA2AMessage } from '../a2a-client.js';

const AGENT_URL = 'http://remote-agent:8092';
const TOKEN = 'brg_test-token-abc123';

/** Helper: build a successful JSON-RPC 2.0 A2A response */
function a2aSuccess(text: string) {
  return {
    jsonrpc: '2.0',
    id: 'ignored',
    result: {
      message: {
        role: 'agent',
        parts: [{ text }],
      },
    },
  };
}

/** Helper: build a JSON-RPC 2.0 error response */
function a2aError(code: number, message: string) {
  return {
    jsonrpc: '2.0',
    id: 'ignored',
    error: { code, message },
  };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('sendA2AMessage', () => {
  it('returns response text from a successful A2A call', async () => {
    server.use(
      http.post(AGENT_URL, () => {
        return HttpResponse.json(a2aSuccess('Hello from remote!'));
      }),
    );

    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'Hi there');
    expect(result).toBe('Hello from remote!');
  });

  it('sends correct Authorization Bearer header', async () => {
    let capturedAuth: string | null = null;

    server.use(
      http.post(AGENT_URL, ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json(a2aSuccess('ok'));
      }),
    );

    await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(capturedAuth).toBe(`Bearer ${TOKEN}`);
  });

  it('includes contextId in params when provided', async () => {
    let capturedBody: any = null;

    server.use(
      http.post(AGENT_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(a2aSuccess('ok'));
      }),
    );

    await sendA2AMessage(AGENT_URL, TOKEN, 'with context', 'ctx-123');
    expect(capturedBody.params.contextId).toBe('ctx-123');
  });

  it('omits contextId when not provided', async () => {
    let capturedBody: any = null;

    server.use(
      http.post(AGENT_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(a2aSuccess('ok'));
      }),
    );

    await sendA2AMessage(AGENT_URL, TOKEN, 'no context');
    expect(capturedBody.params).not.toHaveProperty('contextId');
  });

  it('returns error on 4xx WITHOUT retrying', async () => {
    let callCount = 0;

    server.use(
      http.post(AGENT_URL, () => {
        callCount++;
        return new HttpResponse('Forbidden', { status: 403 });
      }),
    );

    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'bad request');
    expect(result).toMatch(/\[error\]/);
    expect(result).toContain('403');
    expect(callCount).toBe(1);
  });

  it('retries on 5xx errors (calls endpoint multiple times)', async () => {
    let callCount = 0;

    server.use(
      http.post(AGENT_URL, () => {
        callCount++;
        return new HttpResponse('Internal Server Error', { status: 500 });
      }),
    );

    // Use fake timers to skip the exponential backoff delays
    vi.useFakeTimers();
    const resultPromise = sendA2AMessage(AGENT_URL, TOKEN, 'retry me');

    // Advance through all retry delays (1s base * 2^attempt + jitter, 3 attempts)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toMatch(/\[error\].*after retries/);
    expect(callCount).toBe(3);
  });

  it('returns A2A error from JSON-RPC error response', async () => {
    server.use(
      http.post(AGENT_URL, () => {
        return HttpResponse.json(a2aError(-32600, 'Invalid Request'));
      }),
    );

    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'bad rpc');
    expect(result).toBe('[error] A2A error -32600: Invalid Request');
  });

  it('returns error after network failure + retries exhausted', async () => {
    server.use(
      http.post(AGENT_URL, () => {
        return HttpResponse.error();
      }),
    );

    vi.useFakeTimers();
    const resultPromise = sendA2AMessage(AGENT_URL, TOKEN, 'network fail');

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toMatch(/\[error\].*after retries/);
  });

  it('uses JSON-RPC 2.0 format with correct method name', async () => {
    let capturedBody: any = null;

    server.use(
      http.post(AGENT_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(a2aSuccess('ok'));
      }),
    );

    await sendA2AMessage(AGENT_URL, TOKEN, 'format check');

    expect(capturedBody.jsonrpc).toBe('2.0');
    expect(capturedBody.method).toBe('message/send');
    expect(capturedBody.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(capturedBody.params.message).toEqual({
      role: 'user',
      parts: [{ text: 'format check' }],
    });
  });
});
