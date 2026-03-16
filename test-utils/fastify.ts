import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export function buildTestApp(): FastifyInstance {
  return Fastify({ logger: false });
}
