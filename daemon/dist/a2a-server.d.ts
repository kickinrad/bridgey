import type { FastifyInstance } from 'fastify';
import type { BridgeyConfig } from './types.js';
/**
 * Register all A2A and management routes on the Fastify instance.
 */
export declare function a2aRoutes(fastify: FastifyInstance, config: BridgeyConfig): void;
