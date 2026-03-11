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
