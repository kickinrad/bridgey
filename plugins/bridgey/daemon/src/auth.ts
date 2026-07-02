import { randomBytes, timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';
import type { BridgeyConfig } from './types.js';
import { whoisFromSocket } from './tailscale/whois.js';

/**
 * Validate that the request carries a valid Bearer token matching config.token.
 */
export function validateToken(req: FastifyRequest, config: BridgeyConfig): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;

  const supplied = Buffer.from(parts[1]);
  const expected = Buffer.from(config.token);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

/**
 * Check if the request came from the same host (loopback address).
 * Same-host callers skip token auth — the loopback interface already
 * implies physical access to the machine.
 */
export function isLocalAgent(req: FastifyRequest): boolean {
  const remoteAddr = req.ip;
  if (!remoteAddr) return false;

  const localAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  return localAddrs.includes(remoteAddr);
}

/**
 * Generate a new bridgey token: brg_ + 32 random hex characters.
 */
export function generateToken(): string {
  return 'brg_' + randomBytes(16).toString('hex');
}

/**
 * Convert an IPv4 address (or IPv4-mapped IPv6) to a 32-bit unsigned integer.
 */
function ipToLong(ip: string): number {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.');
  if (parts.length !== 4) return 0;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check if an IPv4 address falls within a CIDR range.
 */
export function isInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(network) & mask);
}

/**
 * Check if an IP belongs to any of the configured trusted networks.
 */
export function isTrustedNetwork(ip: string, trustedNetworks?: string[]): boolean {
  if (!trustedNetworks?.length) return false;
  return trustedNetworks.some((cidr) => isInCIDR(ip, cidr));
}

function sourceAddr(req: FastifyRequest): string {
  const port = (req.socket as { remotePort?: number }).remotePort ?? 0;
  return `${req.ip}:${port}`;
}

async function checkTailscaleIdentity(req: FastifyRequest, config: BridgeyConfig): Promise<boolean> {
  const id = await whoisFromSocket(
    sourceAddr(req),
    config.tailscale_sock ?? '/run/tailscale/tailscaled.sock',
  );
  if (!id) return false;

  const users = config.identity_allowlist?.tailscale_users ?? [];
  const nodes = config.identity_allowlist?.tailscale_nodes ?? [];
  return users.includes(id.user) || nodes.includes(id.node);
}

/**
 * Check if a request is authorized via any mechanism:
 * bearer token, local agent, trusted network, or tailscale identity.
 */
export async function isAuthorized(req: FastifyRequest, config: BridgeyConfig): Promise<boolean> {
  if (isLocalAgent(req)) return true;

  const mode = config.identity_mode ?? 'bearer';

  if (mode === 'tailscale') {
    return checkTailscaleIdentity(req, config);
  }

  if (mode === 'both') {
    if (validateToken(req, config) || isTrustedNetwork(req.ip, config.trusted_networks)) return true;
    return checkTailscaleIdentity(req, config);
  }

  // mode === 'bearer' (default)
  return validateToken(req, config) || isTrustedNetwork(req.ip, config.trusted_networks);
}
