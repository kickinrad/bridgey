import type { FastifyRequest } from 'fastify';
import type { BridgeyConfig } from './types.js';
/**
 * Validate that the request carries a valid Bearer token matching config.token.
 */
export declare function validateToken(req: FastifyRequest, config: BridgeyConfig): boolean;
/**
 * Check if the request came from a locally-registered agent (same host).
 * Local agents skip token auth.
 */
export declare function isLocalAgent(req: FastifyRequest, registryDir?: string): boolean;
/**
 * Generate a new bridgey token: brg_ + 32 random hex characters.
 */
export declare function generateToken(): string;
