import { describe, it, expect, afterEach, vi } from 'vitest';

// Isolate env between tests
const originalEnv = process.env;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// We test the agentgateway health section of handleStatus indirectly by
// calling the exported helper. Import the module after setting env so the
// module-level env reads are picked up.

describe('agentgateway health in status output', () => {
  it('shows [ok] when agentgateway readiness endpoint returns 200', async () => {
    process.env.BRIDGEY_AGENTGATEWAY_URL = 'http://agentgateway:8090/mcp';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('15021')) {
        return new Response('ready\n', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const { agentgatewayHealthLine } = await import('../tools.js');
    const line = await agentgatewayHealthLine();
    expect(line).toMatch(/\[ok\]/);
    expect(line).toMatch(/agentgateway/);

    fetchSpy.mockRestore();
  });

  it('shows [--] when agentgateway readiness endpoint is unreachable', async () => {
    process.env.BRIDGEY_AGENTGATEWAY_URL = 'http://agentgateway:8090/mcp';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('15021')) {
        throw new Error('ECONNREFUSED');
      }
      return new Response('{}', { status: 200 });
    });

    const { agentgatewayHealthLine } = await import('../tools.js');
    const line = await agentgatewayHealthLine();
    expect(line).toMatch(/\[--\]/);
    expect(line).toMatch(/agentgateway/);

    fetchSpy.mockRestore();
  });

  it('returns null when BRIDGEY_AGENTGATEWAY_URL is not set', async () => {
    delete process.env.BRIDGEY_AGENTGATEWAY_URL;

    const { agentgatewayHealthLine } = await import('../tools.js');
    const line = await agentgatewayHealthLine();
    expect(line).toBeNull();
  });
});
