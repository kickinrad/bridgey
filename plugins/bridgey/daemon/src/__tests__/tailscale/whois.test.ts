import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { EventEmitter } from 'node:events';

// Mock http module before importing whois
vi.mock('node:http');

import { whoisFromSocket } from '../../tailscale/whois.js';

function makeResponseEmitter(statusCode: number, body: string) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return { res, sendBody: () => { res.emit('data', body); res.emit('end'); } };
}

function makeRequestEmitter() {
  const req = new EventEmitter() as NodeJS.EventEmitter & { end: () => void; destroy: (e?: Error) => void };
  req.end = vi.fn();
  req.destroy = vi.fn();
  return req;
}

describe('whoisFromSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns node and user from a valid whois response', async () => {
    const { res, sendBody } = makeResponseEmitter(200, JSON.stringify({
      Node: { Name: 'bridgey-julia' },
      UserProfile: { LoginName: 'wils@github' },
    }));
    const req = makeRequestEmitter();

    vi.mocked(http.request).mockImplementation((_opts, cb) => {
      cb?.(res as Parameters<typeof http.request>[1] extends ((res: infer R) => void) ? R : never);
      setTimeout(sendBody, 0);
      return req as unknown as http.ClientRequest;
    });

    const result = await whoisFromSocket('100.64.0.1:12345', '/run/tailscale/tailscaled.sock');
    expect(result).toEqual({ node: 'bridgey-julia', user: 'wils@github' });
  });

  it('returns null on 404 (unknown peer)', async () => {
    const { res, sendBody } = makeResponseEmitter(404, '');
    const req = makeRequestEmitter();

    vi.mocked(http.request).mockImplementation((_opts, cb) => {
      cb?.(res as Parameters<typeof http.request>[1] extends ((res: infer R) => void) ? R : never);
      setTimeout(sendBody, 0);
      return req as unknown as http.ClientRequest;
    });

    const result = await whoisFromSocket('192.168.1.1:9999', '/run/tailscale/tailscaled.sock');
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const { res, sendBody } = makeResponseEmitter(200, 'not-json{{{');
    const req = makeRequestEmitter();

    vi.mocked(http.request).mockImplementation((_opts, cb) => {
      cb?.(res as Parameters<typeof http.request>[1] extends ((res: infer R) => void) ? R : never);
      setTimeout(sendBody, 0);
      return req as unknown as http.ClientRequest;
    });

    const result = await whoisFromSocket('100.64.0.2:1234', '/run/tailscale/tailscaled.sock');
    expect(result).toBeNull();
  });

  it('returns null when socket errors', async () => {
    const req = makeRequestEmitter();

    vi.mocked(http.request).mockImplementation(() => {
      setTimeout(() => req.emit('error', new Error('ENOENT')), 0);
      return req as unknown as http.ClientRequest;
    });

    const result = await whoisFromSocket('100.64.0.3:5678', '/run/tailscale/tailscaled.sock');
    expect(result).toBeNull();
  });

  it('uses the correct socket path and URL in the request options', async () => {
    const { res, sendBody } = makeResponseEmitter(200, JSON.stringify({
      Node: { Name: 'bridgey-mila' },
      UserProfile: { LoginName: 'mila@github' },
    }));
    const req = makeRequestEmitter();

    let capturedOpts: Parameters<typeof http.request>[0] | undefined;
    vi.mocked(http.request).mockImplementation((opts, cb) => {
      capturedOpts = opts;
      cb?.(res as Parameters<typeof http.request>[1] extends ((res: infer R) => void) ? R : never);
      setTimeout(sendBody, 0);
      return req as unknown as http.ClientRequest;
    });

    await whoisFromSocket('100.64.0.5:4242', '/custom/tailscaled.sock');
    expect(capturedOpts).toMatchObject({
      socketPath: '/custom/tailscaled.sock',
      // addr is URL-encoded in the query string
      path: expect.stringContaining(encodeURIComponent('100.64.0.5:4242')),
      method: 'GET',
    });
  });
});
