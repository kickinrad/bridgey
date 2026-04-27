import { describe, it, expect, afterEach, vi } from 'vitest';
import { agentgatewayHealthLine } from '../tools.js';

describe('agentgateway health in status output', () => {
  const originalUrl = process.env.BRIDGEY_AGENTGATEWAY_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.BRIDGEY_AGENTGATEWAY_URL;
    } else {
      process.env.BRIDGEY_AGENTGATEWAY_URL = originalUrl;
    }
    vi.restoreAllMocks();
  });

  it('shows [ok] when agentgateway readiness endpoint returns 200', async () => {
    process.env.BRIDGEY_AGENTGATEWAY_URL = 'http://agentgateway:8090/mcp';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('15021')) {
        return new Response('ready\n', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const line = await agentgatewayHealthLine();
    expect(line).toMatch(/\[ok\]/);
    expect(line).toMatch(/agentgateway/);
  });

  it('shows [--] when agentgateway readiness endpoint is unreachable', async () => {
    process.env.BRIDGEY_AGENTGATEWAY_URL = 'http://agentgateway:8090/mcp';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('15021')) {
        throw new Error('ECONNREFUSED');
      }
      return new Response('{}', { status: 200 });
    });

    const line = await agentgatewayHealthLine();
    expect(line).toMatch(/\[--\]/);
    expect(line).toMatch(/agentgateway/);
  });

  it('returns null when BRIDGEY_AGENTGATEWAY_URL is not set', async () => {
    delete process.env.BRIDGEY_AGENTGATEWAY_URL;

    const line = await agentgatewayHealthLine();
    expect(line).toBeNull();
  });
});
