import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isInCIDR, isTrustedNetwork, isAuthorized } from '../auth.js';
import type { FastifyRequest } from 'fastify';
import type { BridgeyConfig } from '../types.js';

vi.mock('../tailscale/whois.js');
import { whoisFromSocket } from '../tailscale/whois.js';

function makeReq(ip: string, token?: string): FastifyRequest {
  return {
    ip,
    socket: { remotePort: 12345 },
    headers: {
      authorization: token ? `Bearer ${token}` : undefined,
    },
  } as unknown as FastifyRequest;
}

const baseConfig: BridgeyConfig = {
  name: 'test',
  description: '',
  port: 7700,
  bind: 'localhost',
  token: 'brg_testtoken',
  workspace: '',
  max_turns: 5,
  agents: [],
  identity_mode: 'bearer',
  tailscale_sock: '/run/tailscale/tailscaled.sock',
};

describe('isInCIDR', () => {
  it('matches IP within Tailscale CGNAT range', () => {
    expect(isInCIDR('100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('100.127.255.255', '100.64.0.0/10')).toBe(true);
  });

  it('matches first IP in range', () => {
    expect(isInCIDR('100.64.0.0', '100.64.0.0/10')).toBe(true);
  });

  it('rejects IP outside CIDR range', () => {
    expect(isInCIDR('192.168.1.1', '100.64.0.0/10')).toBe(false);
    expect(isInCIDR('10.0.0.1', '100.64.0.0/10')).toBe(false);
  });

  it('handles IPv4-mapped IPv6 addresses', () => {
    expect(isInCIDR('::ffff:100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('::ffff:192.168.1.1', '100.64.0.0/10')).toBe(false);
  });

  it('handles /32 single-host CIDR', () => {
    expect(isInCIDR('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(isInCIDR('10.0.0.2', '10.0.0.1/32')).toBe(false);
  });

  it('handles /0 match-all CIDR', () => {
    expect(isInCIDR('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(isInCIDR('255.255.255.255', '0.0.0.0/0')).toBe(true);
  });

  it('handles common private ranges', () => {
    expect(isInCIDR('10.0.0.5', '10.0.0.0/8')).toBe(true);
    expect(isInCIDR('172.16.5.1', '172.16.0.0/12')).toBe(true);
    expect(isInCIDR('192.168.1.100', '192.168.0.0/16')).toBe(true);
  });
});

describe('isTrustedNetwork', () => {
  it('returns false when no trusted networks configured', () => {
    expect(isTrustedNetwork('100.75.44.106', [])).toBe(false);
    expect(isTrustedNetwork('100.75.44.106', undefined)).toBe(false);
  });

  it('returns true when IP matches a trusted network', () => {
    expect(isTrustedNetwork('100.75.44.106', ['100.64.0.0/10'])).toBe(true);
  });

  it('checks multiple CIDRs', () => {
    expect(isTrustedNetwork('10.0.0.5', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(true);
    expect(isTrustedNetwork('172.16.0.1', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(false);
  });

  it('returns false for non-matching IP', () => {
    expect(isTrustedNetwork('8.8.8.8', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(false);
  });
});

describe('isAuthorized', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('identity_mode=bearer (default)', () => {
    it('allows valid bearer token', async () => {
      const req = makeReq('100.64.0.1', 'brg_testtoken');
      const result = await isAuthorized(req, baseConfig);
      expect(result).toBe(true);
    });

    it('denies invalid bearer token', async () => {
      const req = makeReq('100.64.0.1', 'brg_wrong');
      const result = await isAuthorized(req, baseConfig);
      expect(result).toBe(false);
    });

    it('allows localhost regardless of token', async () => {
      const req = makeReq('127.0.0.1');
      const result = await isAuthorized(req, baseConfig);
      expect(result).toBe(true);
    });

    it('does not call whois', async () => {
      const req = makeReq('100.64.0.1', 'brg_testtoken');
      await isAuthorized(req, baseConfig);
      expect(whoisFromSocket).not.toHaveBeenCalled();
    });
  });

  describe('identity_mode=tailscale', () => {
    const tailscaleConfig: BridgeyConfig = {
      ...baseConfig,
      identity_mode: 'tailscale',
      identity_allowlist: {
        tailscale_users: ['wils@github'],
        tailscale_nodes: ['bridgey-julia'],
      },
    };

    it('allows allowlisted user via whois', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'some-host', user: 'wils@github' });
      const req = makeReq('100.64.0.1');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(true);
    });

    it('allows allowlisted node via whois', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'bridgey-julia', user: 'other@github' });
      const req = makeReq('100.64.0.1');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(true);
    });

    it('denies non-allowlisted user', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'unknown-host', user: 'attacker@evil.com' });
      const req = makeReq('100.64.0.1');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(false);
    });

    it('denies when whois returns null (unknown peer)', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue(null);
      const req = makeReq('100.64.0.1');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(false);
    });

    it('denies valid bearer token (strict tailscale mode)', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue(null);
      const req = makeReq('100.64.0.1', 'brg_testtoken');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(false);
    });

    it('still allows localhost', async () => {
      const req = makeReq('127.0.0.1');
      const result = await isAuthorized(req, tailscaleConfig);
      expect(result).toBe(true);
    });
  });

  describe('identity_mode=both', () => {
    const bothConfig: BridgeyConfig = {
      ...baseConfig,
      identity_mode: 'both',
      identity_allowlist: {
        tailscale_users: ['wils@github'],
      },
    };

    it('allows valid bearer even when whois returns non-allowlisted user', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'unknown-host', user: 'attacker@evil.com' });
      const req = makeReq('100.64.0.1', 'brg_testtoken');
      const result = await isAuthorized(req, bothConfig);
      expect(result).toBe(true);
    });

    it('allows allowlisted tailscale user even without bearer token', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'some-host', user: 'wils@github' });
      const req = makeReq('100.64.0.1');
      const result = await isAuthorized(req, bothConfig);
      expect(result).toBe(true);
    });

    it('denies non-allowlisted user with bad bearer token', async () => {
      vi.mocked(whoisFromSocket).mockResolvedValue({ node: 'unknown', user: 'bad@actor.com' });
      const req = makeReq('100.64.0.1', 'brg_wrong');
      const result = await isAuthorized(req, bothConfig);
      expect(result).toBe(false);
    });
  });
});
