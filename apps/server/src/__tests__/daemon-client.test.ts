import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaemonClient } from '../daemon-client.js';

describe('DaemonClient channel methods', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('registerChannel POSTs agent_name and push_url', async () => {
    const client = new DaemonClient(8091);
    await client.registerChannel('bridgey-12345', 'http://127.0.0.1:9000');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:8091/channel/register');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      agent_name: 'bridgey-12345',
      push_url: 'http://127.0.0.1:9000',
    });
  });

  it('unregisterChannel POSTs agent_name', async () => {
    const client = new DaemonClient(8091);
    await client.unregisterChannel('bridgey-12345');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:8091/channel/unregister');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ agent_name: 'bridgey-12345' });
  });

  it('listChannelSessions GETs /channel/sessions and returns sessions array', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessions: [
            { agentName: 'a', pushUrl: 'http://x', registeredAt: '2025-01-01T00:00:00Z' },
            { agentName: 'b', pushUrl: 'http://y', registeredAt: '2025-01-01T00:00:01Z' },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new DaemonClient(8091);
    const sessions = await client.listChannelSessions();
    expect(sessions.map((s) => s.agentName)).toEqual(['a', 'b']);
  });
});
