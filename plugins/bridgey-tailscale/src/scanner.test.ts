import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { parseTailscaleStatus, probePeer } from './scanner.js';

describe('parseTailscaleStatus', () => {
  it('extracts online peers with tailscale IPs', () => {
    const status = {
      Self: {
        HostName: 'luna',
        TailscaleIPs: ['100.100.100.1'],
        Online: true,
        OS: 'linux',
      },
      Peer: {
        'nodekey:abc': {
          HostName: 'mesa',
          TailscaleIPs: ['100.75.44.106', 'fd7a:115c:a1e0::1'],
          Online: true,
          OS: 'linux',
        },
        'nodekey:def': {
          HostName: 'cloud',
          TailscaleIPs: ['100.105.101.128'],
          Online: false,
          OS: 'linux',
        },
        'nodekey:ghi': {
          HostName: 'yoga',
          TailscaleIPs: ['100.123.160.51'],
          Online: true,
          OS: 'windows',
        },
      },
    };

    const peers = parseTailscaleStatus(status);
    expect(peers).toHaveLength(2);
    expect(peers[0].hostname).toBe('mesa');
    expect(peers[0].tailscale_ip).toBe('100.75.44.106');
    expect(peers[1].hostname).toBe('yoga');
  });

  it('excludes self from peer list', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
      Peer: {},
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('handles missing Peer key gracefully', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('filters excluded hostnames', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.1.1.1'], Online: true, OS: 'linux' },
      Peer: {
        'nodekey:a': { HostName: 'mesa', TailscaleIPs: ['100.2.2.2'], Online: true, OS: 'linux' },
        'nodekey:b': { HostName: 'printer', TailscaleIPs: ['100.3.3.3'], Online: true, OS: 'linux' },
      },
    };

    const peers = parseTailscaleStatus(status, ['printer']);
    expect(peers).toHaveLength(1);
    expect(peers[0].hostname).toBe('mesa');
  });
});

// --- HTTP probing tests via MSW ---

const PROBE_IP = '100.50.60.70';
const PROBE_PORT = 8092;
const BASE_URL = `http://${PROBE_IP}:${PROBE_PORT}`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('probePeer', () => {
  it('returns healthy with agent card when both endpoints respond', async () => {
    const agentCard = { name: 'mesa-agent', version: '1.0.0', capabilities: ['chat'] };

    server.use(
      http.get(`${BASE_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
      http.get(`${BASE_URL}/.well-known/agent-card.json`, () => HttpResponse.json(agentCard)),
    );

    const result = await probePeer(PROBE_IP, PROBE_PORT);
    expect(result.healthy).toBe(true);
    expect(result.agentCard).toEqual(agentCard);
  });

  it('returns healthy without agent card when only health responds', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
      http.get(`${BASE_URL}/.well-known/agent-card.json`, () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );

    const result = await probePeer(PROBE_IP, PROBE_PORT);
    expect(result.healthy).toBe(true);
    expect(result.agentCard).toBeUndefined();
  });

  it('returns unhealthy when health endpoint returns non-ok status', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () => new HttpResponse(null, { status: 503 })),
    );

    const result = await probePeer(PROBE_IP, PROBE_PORT);
    expect(result.healthy).toBe(false);
    expect(result.agentCard).toBeUndefined();
  });

  it('returns unhealthy on connection error (network failure)', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () => HttpResponse.error()),
    );

    const result = await probePeer(PROBE_IP, PROBE_PORT);
    expect(result.healthy).toBe(false);
  });

  it('returns unhealthy on timeout', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, async () => {
        // Delay longer than the timeout we'll pass
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const result = await probePeer(PROBE_IP, PROBE_PORT, 100);
    expect(result.healthy).toBe(false);
  }, 10000);

  it('returns unhealthy when probing wrong port (no handler)', async () => {
    // No MSW handlers for this port — fetch will get a network error
    const result = await probePeer(PROBE_IP, 9999);
    expect(result.healthy).toBe(false);
  });
});
