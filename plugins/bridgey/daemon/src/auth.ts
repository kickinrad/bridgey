import { randomBytes, timingSafeEqual } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { FastifyRequest } from 'fastify';
import type { BridgeyConfig } from './types.js';

const REGISTRY_DIR = join(homedir(), '.bridgey', 'agents');

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
 * Check if the request came from a locally-registered agent (same host).
 * Local agents skip token auth.
 */
export function isLocalAgent(req: FastifyRequest, registryDir: string = REGISTRY_DIR): boolean {
  const remoteAddr = req.ip;
  if (!remoteAddr) return false;

  // Only consider loopback addresses as local
  const localAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!localAddrs.includes(remoteAddr)) return false;

  // Verify there are registered local agents
  try {
    const files = readdirSync(registryDir).filter((f) => f.endsWith('.json'));
    return files.length > 0;
  } catch {
    return false;
  }
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

/**
 * Check if a request is authorized via any mechanism:
 * bearer token, local agent registry, or trusted network.
 */
export function isAuthorized(req: FastifyRequest, config: BridgeyConfig): boolean {
  return validateToken(req, config) || isLocalAgent(req) || isTrustedNetwork(req.ip, config.trusted_networks);
}
